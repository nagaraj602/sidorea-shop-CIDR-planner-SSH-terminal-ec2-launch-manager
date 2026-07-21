# ==========================================
# STAGE 1: Build & Dependencies
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools (ssh2 occasionally requires native compilation)
RUN apk add --no-cache python3 make g++ 

COPY package*.json ./
RUN npm install

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

# Copy the compiled API code from the builder
COPY --from=builder /app /app

# Create necessary directories for runtime data
RUN mkdir -p /app/data/keys /app/data/terraform_workspaces

EXPOSE 3000

CMD ["node", "server.js"]
