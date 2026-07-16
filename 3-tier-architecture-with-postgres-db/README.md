# Sidorea - 3-Tier Cloud Manager & SSH Workspace

A production-grade **3-tier web platform** designed for DevOps engineers and cloud administrators.

This application provides a unified dashboard to:

- Calculate CIDR ranges
- Connect to Linux servers using a web-based SSH terminal
- Design AWS VPC architectures visually
- Manage AWS EC2 instances dynamically

This repository contains the **3-Tier Architecture** version of the application, consisting of:

- Frontend
- Node.js API Backend
- PostgreSQL Database

---

# 📑 Table of Contents

- [Architecture Overview](#-architecture-overview)
- [Key Features](#-key-features)
- [Prerequisites](#-prerequisites)
- [Bare Metal Installation (PM2)](#-bare-metal-installation-pm2)
- [Docker Deployment](#-docker-deployment)
- [Kubernetes Deployment](#-kubernetes-deployment)
- [Enable HTTPS with Nginx & Certbot](#-enable-https-with-nginx--certbot)
- [Security Notice](#-security-notice)

---

# 🏗️ Architecture Overview

The application follows a **3-tier architecture**, allowing independent scaling, better security, and easier maintenance.

## 1. Presentation Tier (Frontend)

- Pure HTML, CSS and JavaScript
- Served through Nginx or any lightweight static web server
- Provides:
  - SSH Terminal (Xterm.js)
  - AWS Configuration UI
  - CIDR Calculator
  - VPC Builder

---

## 2. Application Tier (Backend API)

- Node.js
- Express.js
- Runs on **Port 3000**

Responsibilities:

- Executes Terraform workspaces
- Creates WebSocket SSH tunnels using `ssh2`
- Communicates with AWS SDK
- Stores application data

---

## 3. Data Tier (Database)

PostgreSQL database used to securely store:

- AWS Credentials
- Generated SSH `.pem` Keys
- CIDR Calculation History
- User Layouts
- Application Configuration

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
- Separate Terraform workspaces
- Automatic state management

### Automatic AWS Discovery

Automatically retrieves:

- Region-specific AMIs
- Security Groups
- Key Pairs

### Dynamic AWS Key Generation

Generate `.pem` keys directly from the browser.

The application:

- Saves the key locally
- Stores a secure copy in the backend vault

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

The builder can automatically generate production-ready Terraform (`main.tf`) configuration.

---

# 📋 Prerequisites

Ensure your environment has the following:

- Ubuntu/Debian Linux (Recommended)
- Node.js 18+
- npm
- PostgreSQL 13+
- Terraform CLI
- Docker (Optional)
- Kubernetes (Optional)

---

# 🚀 Bare Metal Installation (PM2)
You can either install using the manual setup shown below or else, you just run the script and it will handle everything:
```
bash script.sh
```
##Manual Method:
## Step 1 — Configure PostgreSQL

Create the database and user.

```sql
CREATE DATABASE sidorea_db;

CREATE USER sidorea_user
WITH ENCRYPTED PASSWORD 'your_secure_password';

GRANT ALL PRIVILEGES
ON DATABASE sidorea_db
TO sidorea_user;
```

---

## Step 2 — Configure Backend API

Navigate to the backend directory.

```bash
cd 3-tier-architecture-with-postgres-db/backend_api

npm install
```

Create a `.env` file inside the `backend_api` directory.

```env
PORT=3000

DB_USER=sidorea_user
DB_HOST=127.0.0.1
DB_NAME=sidorea_db
DB_PASSWORD=your_secure_password
DB_PORT=5432
```

Install PM2.

```bash
sudo npm install -g pm2
```

Start the backend.

```bash
pm2 start server.js --name sidorea-api

pm2 save
```

---

## Step 3 — Serve Frontend

Serve the `frontend_public` directory using:

- Nginx
- Apache
- Any static web server

Ensure it points to the backend API running on Port **3000**.

---

# 🐳 Docker Deployment

The repository includes optimized multi-stage Dockerfiles.

The backend Docker image already contains Terraform for infrastructure provisioning.

## Build Backend

```bash
cd backend_api

docker build -t sidorea-backend:latest .
```

---

## Build Frontend

```bash
cd ../frontend_public

docker build -t sidorea-frontend:latest .
```

---

## Run Containers

Ensure PostgreSQL is already running.

Backend:

```bash
docker run -d \
-p 3000:3000 \
--env-file ./backend_api/.env \
sidorea-backend:latest
```

Frontend:

```bash
docker run -d \
-p 8080:80 \
sidorea-frontend:latest
```

---

# ☸️ Kubernetes Deployment

The repository includes a complete Kubernetes manifest.

Resources created:

- ConfigMap
- Secret
- PostgreSQL StatefulSet
- PersistentVolumeClaim
- Backend Deployment
- Backend PVC
- Frontend Deployment
- Frontend ConfigMap
- Services
- NodePort (30080)

Deploy everything:

```bash
kubectl apply -f k8s-manifest.yaml
```

Access the application:

```
http://<Node-IP>:30080
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
6. Configures Nginx reverse proxy

Routing:

| Path | Destination |
|------|-------------|
| `/` | Frontend (Port 8080) |
| `/api/` | Backend (Port 3000) |
| `/socket.io/` | Backend (Port 3000) |

> **Note**
>
> If using Kubernetes, ignore this script and instead configure **cert-manager** with an Ingress resource.

---

# ⚠️ Security Notice

This application acts as a central control plane for AWS and SSH infrastructure.

Before deploying to production:

- Never expose the application to the public Internet without HTTPS.
- AWS Access Keys are stored in PostgreSQL.
- SSH Private Keys are stored in the backend.
- Implement user authentication (OAuth/JWT).
- Enable Role-Based Access Control (RBAC).
- Restrict access using IP whitelisting.
- Follow the Principle of Least Privilege for all AWS IAM credentials.


---

# 👨‍💻 Author

Developed by **Sidorea**.
