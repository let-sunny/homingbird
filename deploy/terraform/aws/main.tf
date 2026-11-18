terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.region
}

locals {
  database_name = "homingbird"
  database_user = "homingbird"
  container     = "dovecote"
  port          = 8080

  environment = { for name, value in merge({
    HB_PUBLIC_URL           = var.public_url
    HB_OIDC_ISSUER          = var.oidc_issuer
    HB_OIDC_CLIENT_ID       = var.oidc_client_id
    HB_ALLOWED_DOMAINS      = join(",", var.allowed_domains)
    HB_ADMIN_EMAILS         = join(",", var.admin_emails)
    HB_CHANNELS             = join(",", var.channels)
    HB_CONTACT_MODE         = var.contact_mode
    HB_AUDIT_WEBHOOK_URL    = var.audit_webhook_url
    HB_AUDIT_RETENTION_DAYS = var.audit_retention_days == null ? "" : tostring(var.audit_retention_days)
    HB_TRUST_PROXY          = "1"
    HB_AUDIT_STDOUT         = "1"
  }, var.extra_environment) : name => value if value != "" }
}

resource "aws_security_group" "load_balancer" {
  name_prefix = "${var.name}-alb-"
  description = "HTTPS from the internet to the Dovecote load balancer"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.ingress_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "service" {
  name_prefix = "${var.name}-service-"
  description = "Dovecote task: reachable only from its load balancer"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Dovecote from the load balancer"
    from_port       = local.port
    to_port         = local.port
    protocol        = "tcp"
    security_groups = [aws_security_group.load_balancer.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "database" {
  name_prefix = "${var.name}-database-"
  description = "PostgreSQL: reachable only from the Dovecote task"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from Dovecote"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.service.id]
  }
}

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "dovecote" {
  name_prefix = "${var.name}-"
  subnet_ids  = var.private_subnet_ids
}

resource "aws_db_instance" "dovecote" {
  identifier_prefix         = "${var.name}-"
  engine                    = "postgres"
  engine_version            = "16"
  instance_class            = var.database_instance_class
  allocated_storage         = 20
  max_allocated_storage     = 200
  storage_encrypted         = true
  db_name                   = local.database_name
  username                  = local.database_user
  password                  = random_password.database.result
  db_subnet_group_name      = aws_db_subnet_group.dovecote.name
  vpc_security_group_ids    = [aws_security_group.database.id]
  multi_az                  = var.database_multi_az
  backup_retention_period   = 7
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = !var.deletion_protection
  final_snapshot_identifier = var.deletion_protection ? "${var.name}-final" : null
}

resource "aws_secretsmanager_secret" "database_url" {
  name_prefix = "${var.name}-database-url-"
}

# The URL carries no sslmode, so the connection is not TLS-encrypted inside the VPC. See the README.
resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgres://${local.database_user}:${random_password.database.result}@${aws_db_instance.dovecote.address}:5432/${local.database_name}"
}

resource "aws_secretsmanager_secret" "oidc_client_secret" {
  name_prefix = "${var.name}-oidc-client-secret-"
}

resource "aws_secretsmanager_secret_version" "oidc_client_secret" {
  secret_id     = aws_secretsmanager_secret.oidc_client_secret.id
  secret_string = var.oidc_client_secret
}

data "aws_iam_policy_document" "assume_by_ecs_tasks" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name_prefix        = "${var.name}-execution-"
  assume_role_policy = data.aws_iam_policy_document.assume_by_ecs_tasks.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "read_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.database_url.arn,
      aws_secretsmanager_secret.oidc_client_secret.arn,
    ]
  }
}

resource "aws_iam_role_policy" "read_secrets" {
  name_prefix = "read-secrets-"
  role        = aws_iam_role.execution.id
  policy      = data.aws_iam_policy_document.read_secrets.json
}

resource "aws_iam_role" "task" {
  name_prefix        = "${var.name}-task-"
  assume_role_policy = data.aws_iam_policy_document.assume_by_ecs_tasks.json
}

resource "aws_cloudwatch_log_group" "dovecote" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lb" "dovecote" {
  name_prefix        = "hb-"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.load_balancer.id]
  subnets            = var.public_subnet_ids

  # Event streams are quiet between notes. The limit is 4000 seconds; Dovecote's heartbeat must be shorter.
  idle_timeout = 3600
}

resource "aws_lb_target_group" "dovecote" {
  name_prefix          = "hb-"
  port                 = local.port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    path                = "/healthz"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.dovecote.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.dovecote.arn
  }
}

resource "aws_ecs_cluster" "dovecote" {
  name = var.name
}

resource "aws_ecs_task_definition" "dovecote" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = local.container
      image     = var.image
      essential = true
      portMappings = [
        { containerPort = local.port, protocol = "tcp" },
      ]
      environment = [for name, value in local.environment : { name = name, value = value }]
      secrets = [
        { name = "HB_DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "HB_OIDC_CLIENT_SECRET", valueFrom = aws_secretsmanager_secret.oidc_client_secret.arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.dovecote.name
          awslogs-region        = var.region
          awslogs-stream-prefix = local.container
        }
      }
    },
  ])

  depends_on = [
    aws_secretsmanager_secret_version.database_url,
    aws_secretsmanager_secret_version.oidc_client_secret,
  ]
}

resource "aws_ecs_service" "dovecote" {
  name            = var.name
  cluster         = aws_ecs_cluster.dovecote.id
  task_definition = aws_ecs_task_definition.dovecote.arn
  launch_type     = "FARGATE"

  # Live delivery fans out inside one process: exactly one task, and a deployment stops it before starting
  # the next so that two never serve at once. Do not attach an autoscaling policy.
  desired_count                      = 1
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  health_check_grace_period_seconds  = 30

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.dovecote.arn
    container_name   = local.container
    container_port   = local.port
  }

  depends_on = [aws_lb_listener.https]
}
