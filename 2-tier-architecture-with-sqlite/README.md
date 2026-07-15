# sidorea-shop-CIDR-planner-SSH-terminal-ec2-launch-manager

A comprehensive, all-in-one web platform designed for **DevOps Beginners**. This application provides a unified dashboard to calculate CIDR, connect to servers via a fully featured web-based SSH terminal, design AWS VPC architectures, and manage AWS EC2 instances dynamically.

Built with **Node.js, Express, Socket.io, SQLite, Terraform, and the AWS SDK**.

---

# 📑 Table of Contents

- [Overview](#overview)
- [Key Features](#-key-features)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Running the Script](#-running-the-script)
- [Manual Method](#-manual-method)
- [Starting the Application](#-starting-the-application)
- [Useful PM2 Commands](#-useful-pm2-commands)
- [Enable HTTPS with Nginx & Certbot](#-enable-https-with-nginx--certbot)
- [Security Notice](#-security-notice)

---

# Overview

This platform combines multiple DevOps utilities into a single web application.

It includes:

- Cloud CIDR Calculator
- Browser-based SSH Terminal
- AWS EC2 Launch & Management
- AWS VPC Visual Designer
- Terraform Code Generator
- AWS Infrastructure Reference Studio

---

# ✨ Key Features

## 🌐 Web SSH & AWS Instance Manager (`/ssh`)

- Connect to multiple Linux servers simultaneously.
- Side-by-side split terminal view.
- Infinite horizontal scrolling.
- Live Sparkline Metrics
  - CPU
  - Memory
  - Disk Usage
- One-click SFTP Upload
- One-click SFTP Download
- Native AWS EC2 Controls
  - Start
  - Stop
  - Reboot
  - Terminate
- Dynamic EC2 Provisioning using Terraform workspaces.
- Automatically retrieves:
  - Region-specific AMIs
  - Security Groups
  - Key Pairs

---

## 🧮 Cloud CIDR Calculator (`/app`)

- Calculate AWS-compatible CIDR ranges.
- Create valid subnet layouts.
- View:
  - Total IP addresses
  - Usable IP addresses
  - AWS Reserved IPs
  - Network Address
  - Broadcast Address
- Save network designs locally.
- Restore previously saved architectures.

---

## 🏗️ AWS VPC Builder (`/vpc`)

Design AWS architectures visually.

Supported resources include:

- VPC
- Public Subnets
- Private Subnets
- EC2 Instances
- Security Groups

Automatically generates production-ready Terraform (`main.tf`) configuration from the visual topology.

---

## 📚 Infrastructure Studios (`/ec2` & `/storage`)

Quick reference dashboards for:

- AWS Storage Services
- EBS Volume Types
- Performance Limits
- Throughput Comparisons
- Linux Mount Commands
- Formatting Runbooks

---

# 📋 Prerequisites

Before installing the application, ensure your server meets the following requirements.

- Ubuntu/Debian Linux (Recommended)
- Node.js 18 or later
- npm
- Terraform CLI
- sudo privileges

---

# 🚀 Installation
You can Either setup everything manually or using script written for it. We have documented both.

## Running the Script
The repository includes an automated setup script that installs all required dependencies and prepares the application.

```bash
./script.sh
```
OR
```bash
bash script.sh
```
Once the setup completes successfully, proceed to start the application using PM2.

# Manual method:
---
## 1. Update the System

```bash
sudo apt update
sudo apt upgrade -y
```

---

## 2. Clone the Repository

```bash
git clone https://github.com/nagaraj602/sidorea-shop-CIDR-planner-SSH-terminal-ec2-launch-manager.git

cd sidorea-shop-CIDR-planner-SSH-terminal-ec2-launch-manager
```

---

## 3. Install Node.js Dependencies

```bash
npm install
```

---

## 4. Install Terraform

Skip this step if Terraform is already installed.

```bash
sudo apt-get update
sudo apt-get install -y gnupg software-properties-common

wget -O- https://apt.releases.hashicorp.com/gpg \
| gpg --dearmor \
| sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg

gpg --no-default-keyring \
--keyring /usr/share/keyrings/hashicorp-archive-keyring.gpg \
--fingerprint

echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
| sudo tee /etc/apt/sources.list.d/hashicorp.list

sudo apt update

sudo apt-get install terraform
```

---

## 5. Install PM2

```bash
sudo npm install -g pm2
```

---

# ▶️ Starting the Application

Start the application:

```bash
sudo pm2 start server.js --name cidr-app
```

Enable automatic startup after server reboot:

```bash
sudo pm2 startup
sudo pm2 save
```

After the application starts, open your browser and navigate to:

```
http://<Public-IP>
```

or

```
http://<Domain-Name>
```

---

# 🛠 Useful PM2 Commands

Restart application

```bash
sudo pm2 restart cidr-app
```

View logs

```bash
sudo pm2 logs cidr-app
```

Stop application

```bash
sudo pm2 stop cidr-app
```

Check status

```bash
sudo pm2 status
```

Delete application

```bash
sudo pm2 delete cidr-app
```

---

# 🔒 Enable HTTPS with Nginx & Certbot

By default, the application runs directly on **Port 80**.

For production deployments, it is recommended to place **Nginx** in front of the Node.js application as a reverse proxy and use **Let's Encrypt** with **Certbot** to automatically generate and renew SSL certificates.
You can ignore this, if you have used script.sh file to setup this things.

---

## Step 1 — Install Nginx and Certbot

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

---

## Step 2 — Configure Nginx Reverse Proxy

Create a new Nginx configuration file:

```bash
sudo vi /etc/nginx/sites-available/sidorea
```

Paste the following configuration:

```nginx
server {
    listen 80;
    server_name sidorea.shop www.sidorea.shop;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable the configuration:

```bash
sudo ln -s /etc/nginx/sites-available/sidorea /etc/nginx/sites-enabled/
```

Test the configuration:

```bash
sudo nginx -t
```

Restart Nginx:

```bash
sudo systemctl restart nginx
```

---

## Step 3 — Verify Route 53 Configuration

Ensure your Route 53 Hosted Zone contains an **A Record** pointing to your EC2 instance's **Public IPv4 Address**.

Example:

| Record | Value |
|---------|-------|
| sidorea.shop | EC2 Public IPv4 |
| www.sidorea.shop | EC2 Public IPv4 |

---

## Step 4 — Generate the SSL Certificate

Run:

```bash
sudo certbot --nginx -d sidorea.shop -d www.sidorea.shop
```

Certbot will:

- Validate your domain.
- Download a free Let's Encrypt certificate.
- Configure Nginx automatically.
- Enable automatic certificate renewal.

When prompted whether to redirect HTTP to HTTPS, choose:

```
Option 2
Redirect all HTTP traffic to HTTPS
```

After completion, your application will be securely available at:

```
https://sidorea.shop
```

The Web SSH Terminal, Socket.io connections, and Terraform provisioning features will continue functioning correctly behind the secure Nginx reverse proxy.

---

# ⚠️ Security Notice

This project is intended for:

- Learning
- Personal Labs
- Sandbox Environments
- DevOps Practice

Before exposing it to the public internet, consider implementing:

- HTTPS (SSL/TLS)
- User Authentication (OAuth/JWT)
- Role-Based Access Control (RBAC)
- Secure Secret Management
- IAM Least-Privilege Policies
- Database Encryption
- Firewall Rules
- Rate Limiting

> **Important:** The application stores AWS credentials and SSH private keys in a local SQLite database (`app_data.db`). Never deploy this application publicly without implementing proper authentication, encryption, and access controls.
