# Sidorea 3-Tier Cloud Manager & SSH Workspace

A production-grade, 3-tier web platform designed for DevOps engineers and cloud administrators. This application provides a unified dashboard to calculate CIDR, connect to servers via a fully featured web-based SSH terminal, design AWS VPC architectures, and manage AWS EC2 instances dynamically.

This specific repository contains the **3-Tier Architecture** version of the application, utilizing a decoupled Frontend, a Node.js API Backend, and a PostgreSQL Database.

---

# 📑 Table of Contents

- [Architecture Overview](#architecture-overview)
- [Key Features](#-key-features)
- [Prerequisites](#-prerequisites)
- [Bare Metal Installation (PM2)](#-bare-metal-installation-pm2)
- [Docker Deployment](#-docker-deployment)
- [Kubernetes Deployment (Bare Metal)](#-kubernetes-deployment)
- [Enable HTTPS (Nginx & SSL)](#-enable-https-with-nginx--certbot)
- [Security Notice](#-security-notice)

---

# 🏗️ Architecture Overview

The 3-tier model ensures high availability, independent scaling, and secure data isolation.

1. **Presentation Tier (Frontend):** - Pure HTML/CSS/JS served via Nginx or a lightweight static server.
   - Handles the terminal UI (Xterm.js) and AWS configuration modals.
2. **Application Tier (Backend API):**
   - Node.js & Express API running on Port 3000.
   - Executes Terraform workspaces (`child_process`), manages WebSocket SSH tunnels (`ssh2`), and interacts with the AWS SDK.
3. **Data Tier (Database):**
   - **PostgreSQL** database.
   - Securely stores AWS credentials, generated SSH `.pem` keys, CIDR history, and user layouts.

---

# ✨ Key Features

## 🌐 Web SSH & AWS Instance Manager (`/ssh`)
- Connect to multiple Linux servers simultaneously with side-by-side split terminal view and horizontal scrolling.
- Live Sparkline Metrics (CPU, Memory, Disk Usage).
- One-click SFTP Upload & Download directly to/from the terminal's working directory.
- Native AWS EC2 Controls (Start, Stop, Reboot, Terminate).
- Dynamic EC2 Provisioning using native Terraform workspaces.
- Automatically retrieves Region-specific AMIs, Security Groups, and Key Pairs.
- **Dynamic AWS Key Generation:** Create `.pem` keys directly from the browser, saving them locally and to the backend vault.

## 🧮 Cloud CIDR Calculator & 🏗️ VPC Builder
- Calculate AWS-compatible CIDR ranges and subnet layouts.
- Design AWS architectures visually (VPC, Subnets, EC2, SGs).
- Automatically generate production-ready Terraform (`main.tf`) configuration from the visual topology.

---

# 📋 Prerequisites

Ensure your host environment meets the following requirements:
- Ubuntu/Debian Linux (Recommended)
- Node.js 18 or later & `npm`
- PostgreSQL 13+ (If running bare metal)
- Terraform CLI (Required on the Backend)
- Docker & Kubernetes (If containerizing)

---

# 🚀 Bare Metal Installation (PM2)

If you are running the application natively on a Linux server without containers, follow these steps.

## 1. Setup PostgreSQL
Create the database and user for the application:
```sql
CREATE DATABASE sidorea_db;
CREATE USER sidorea_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE sidorea_db TO sidorea_user;
