# 🚀 Backend Service Deployment

This repository manages the backend service, including Docker image builds and deployments via GitHub Actions.

## 🔀 Branch

- **main** → Used for production and QA Docker builds.

## 🐳 Docker Image Build & Deployment

### 🔧 Workflow Trigger

Docker builds are triggered **manually** using **workflow_dispatch** via GitHub Actions.

### 🏷️ Tags

You can choose to build and push the Docker image with one of the following tags:

- `latest` → Used for production deployment.
- `qa` → Used for QA environments (e.g., QAVM2).

### 📦 Docker Image

The backend is containerized and the Docker image is built from the root of the repository using the `ci.yaml` workflow file.

## 📄 GitHub Actions

- **Workflow File:** `.github/workflows/ci.yaml`
- **Action Name:** Docker build to trigger manually based on workflow dispatch -**branch Name:** main

### 🧪 Triggering a Build

To manually trigger a build:

1. Go to the **Actions** tab on GitHub.
2. Select the **Build**
3. Select branch and mention the tags and run the workflow.
