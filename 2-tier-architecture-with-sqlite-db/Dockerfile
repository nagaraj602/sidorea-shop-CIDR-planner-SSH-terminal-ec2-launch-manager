# ==========================================
# STAGE 1: Build & Dependencies
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies required for sqlite3 and ssh2 native modules
RUN apk add --no-cache python3 make g++ 

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# ==========================================
# STAGE 2: Production Runtime
# ==========================================
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install Terraform (Required by server.js child_process)
RUN apk add --no-cache curl unzip \
    && curl -O https://releases.hashicorp.com/terraform/1.8.0/terraform_1.8.0_linux_amd64.zip \
    && unzip terraform_1.8.0_linux_amd64.zip -d /usr/local/bin/ \
    && rm terraform_1.8.0_linux_amd64.zip \
    && apk del curl unzip

# Copy the compiled Node modules and app code from the builder stage
COPY --from=builder /app /app

# Create the data directory for SQLite and Terraform workspaces
RUN mkdir -p /app/data/keys /app/data/terraform_workspaces

EXPOSE 3000

CMD ["node", "server.js"]
