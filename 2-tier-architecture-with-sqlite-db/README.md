# Sidorea - 2-Tier Cloud Manager & SSH Workspace

A lightweight, streamlined **2-tier web platform** designed for DevOps engineers and cloud administrators.

This application provides a unified dashboard to:

- Calculate CIDR ranges
- Connect to Linux servers using a web-based SSH terminal
- Design AWS VPC architectures visually
- Manage AWS EC2 instances dynamically

This repository contains the **2-Tier Architecture** version of the application. It runs as a **monolithic Node.js application** that serves both the frontend and backend, while using a local **SQLite** database for maximum simplicity and portability.

---

# 📑 Table of Contents

- [Architecture Overview](#-architecture-overview)
- [Key Features](#-key-features)
- [Prerequisites](#-prerequisites)
- [Bare Metal Installation (PM2)](#-bare-metal-installation-pm2)
- [Docker Deployment](#-docker-deployment)
- [Enable HTTPS with Nginx & Certbot](#-enable-https-with-nginx--certbot)
- [Kubernetes Deployment](#-kubernetes-deployment)
- [Security Notice](#-security-notice)

---

# 🏗️ Architecture Overview

The application follows a **2-tier architecture**, making it easy to deploy while consuming minimal system resources.

## 1. Application Tier (Node.js & Express)

- Runs on **Port 3000**
- Serves both the frontend and backend from a single Node.js process

Responsibilities include:

- Serving HTML, CSS and JavaScript
- Executing Terraform workspaces
- Creating WebSocket SSH tunnels using `ssh2`
- Communicating with AWS SDK
- Managing SSH sessions
- Handling AWS resource provisioning

---

## 2. Data Tier (SQLite)

A lightweight **SQLite** database stores all application data locally.

Database location:

```
/data/app_data.db
```

The database securely stores:

- AWS Credentials
- Generated SSH `.pem` Keys
- CIDR Calculation History
- User Layouts
- Application Configuration

Unlike the 3-tier version, **no external PostgreSQL server is required**.

---

# ✨ Key Features

## 🌐 Web SSH & AWS Instance Manager (`/ssh`)

### SSH Features

- Multiple SSH sessions simultaneously
- Split-screen terminals
- Horizontal scrolling
- Fully interactive terminal

### Live Monitoring

- CPU Usage
- Memory Usage
- Disk Usage

### File Transfer

- One-click SFTP Upload
- One-click SFTP Download

### Native AWS Controls

- Start EC2
- Stop EC2
- Reboot EC2
- Terminate EC2

### Terraform Integration

- Dynamic EC2 provisioning
- Native Terraform workspaces
- Automatic state management

### Automatic AWS Discovery

Automatically retrieves:

- Region-specific AMIs
- Security Groups
- Key Pairs

### Dynamic AWS Key Generation

Generate `.pem` keys directly from the browser.

The application automatically:

- Downloads the key to your computer
- Stores a secure copy locally for future use

---

## 🧮 Cloud CIDR Calculator

- AWS-compatible CIDR calculations
- Automatic subnet generation
- Network planning
- Address validation

---

## 🏗️ AWS VPC Builder

Design AWS infrastructure visually.

Supported resources include:

- VPC
- Public Subnets
- Private Subnets
- EC2 Instances
- Security Groups

Automatically generate production-ready Terraform (`main.tf`) configuration from the visual topology.

---

# 📋 Prerequisites

Ensure your environment meets the following requirements:

- Ubuntu/Debian Linux (Recommended)
- Node.js 18+
- npm
- Terraform CLI
- Docker (Optional)
- Kubernetes (Optional)

---

# 🚀 Bare Metal Installation (PM2)
You can either install using the manual setup shown below or else, you just run the script and it will handle everything:
```
bash script.sh
```
## Manual Method:
If you are running the application directly on a Linux server without containers, follow these steps.

## Step 1 — Install Dependencies

Navigate to the project directory.

```bash
cd 2-tier-architecture-with-sqlite-db

npm install
```

SQLite will automatically be installed during dependency installation.

---

## Step 2 — Start the Application

No external database configuration is required.

Install PM2.

```bash
sudo npm install -g pm2
```

Start the application.

```bash
pm2 start server.js --name sidorea-app

pm2 save
```

Access the application at:

```
http://<Your-Server-IP>:3000
```

For accessing the app without specifying the port number 3000, follow here: - [Enable HTTPS with Nginx & Certbot](#-enable-https-with-nginx--certbot)
---


# 🐳 Docker Deployment

The repository includes an optimized multi-stage Dockerfile.

The image includes:

- SQLite
- Terraform CLI
- Node.js Runtime

## Build the Image

```bash
docker build -t sidorea-2tier:latest .
```

---

## Run the Container

A Docker volume is mounted to preserve:

- SQLite database
- Terraform workspaces
- Generated SSH keys

```bash
docker run -d \
  -p 3000:3000 \
  -v sidorea_data:/app/data \
  --name sidorea-app \
  sidorea-2tier:latest
```

---
# 🔒 Enable HTTPS with Nginx & Certbot

For Bare Metal or Docker deployments, use the included SSL installation script.

```bash
sudo bash SSL-install-script.sh
```

The script automatically:

1. Installs Nginx
2. Installs Certbot
3. Prompts for your domain name
4. Verifies DNS propagation
5. Generates Let's Encrypt SSL certificates
6. Configures Nginx as a reverse proxy

Routing:

| Path | Destination |
|------|-------------|
| `/` | Node.js Application (Port 3000) |
| `/socket.io/` | Node.js Application (Port 3000) |

> **Note**
>
> If deploying on Kubernetes, ignore this script and instead configure **cert-manager** with an Ingress resource.
---

# ☸️ Kubernetes Deployment

A complete Kubernetes manifest (`k8s-manifest.yaml`) is included.

Since the application depends on local SQLite storage and locally generated SSH keys, it uses a **StatefulSet** instead of a Deployment to guarantee persistent storage.

Resources created include:

- ConfigMap
- PersistentVolumeClaim (5Gi)
- StatefulSet
- NodePort Service (30080)

Deploy everything:

```bash
kubectl apply -f k8s-manifest.yaml
```

Access the application at:

```
http://<Node-IP>:30080
```

---

# ⚠️ Security Notice

This application acts as a central control plane for AWS and SSH infrastructure.

Before deploying to production:

- Never expose the application to the public Internet without HTTPS.
- AWS Access Keys are stored in the local SQLite database.
- SSH Private Keys are stored in the local file system.
- Implement user authentication (OAuth/JWT).
- Enable Role-Based Access Control (RBAC).
- Restrict access using IP whitelisting.
- Follow the Principle of Least Privilege for all AWS IAM credentials.

---

# 👨‍💻 Author

Developed by **Sidorea**.
