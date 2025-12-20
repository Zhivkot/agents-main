# Custom Amplify Build Image

This folder contains a custom Docker image for AWS Amplify builds that includes:
- Docker (from base Amazon Linux 2 CodeBuild image)
- Node.js 18 LTS with npm (via nvm)
- Java Corretto 11 (from base image)

## Prerequisites

1. **AWS CLI configured** with permissions for ECR Public
2. **Docker installed** locally
3. **ECR Public repository created** at https://gallery.ecr.aws/

## Setup Instructions

### 1. Create ECR Public Repository

1. Go to https://gallery.ecr.aws/
2. Click "Create repository"
3. Choose a repository name (e.g., `amplify-build-custom`)
4. Make sure visibility is set to **Public**
5. Note your ECR Public alias (e.g., `a1b2c3d4`)

### 2. Build and Push Image

```bash
cd .amplify-build-image

# Make script executable
chmod +x build-and-push.sh

# Build and push (replace with your ECR Public alias)
./build-and-push.sh your-ecr-alias amplify-build-custom
```

### 3. Update Amplify Console

1. Go to your Amplify app in AWS Console
2. Navigate to **App settings** > **Build settings**
3. Click **Edit** on Build image settings
4. Select **Custom build image**
5. Enter your public ECR image URI: `public.ecr.aws/your-alias/amplify-build-custom:latest`

### 4. Simplify amplify.yml

Once using the custom image, you can simplify your `amplify.yml`:

```yaml
version: 1
backend:
  phases:
    preBuild:
      commands:
        - echo "Verifying pre-installed tools..."
        - node --version
        - npm --version
        - docker --version
    build:
      commands:
        - npm ci --cache .npm --prefer-offline
        - npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID
frontend:
  phases:
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - .npm/**/*
      - node_modules/**/*
```

## Benefits

- ✅ No more Node.js installation during build (faster builds)
- ✅ Consistent environment across builds
- ✅ Docker and Node.js pre-configured and tested
- ✅ Based on official AWS CodeBuild image
- ✅ nvm available for Amplify compatibility
- ✅ Publicly accessible (no ECR permissions needed)

## Example Usage

```bash
# If your ECR Public alias is "a1b2c3d4"
./build-and-push.sh a1b2c3d4 amplify-build-custom

# This creates: public.ecr.aws/a1b2c3d4/amplify-build-custom:latest
```

## Troubleshooting

If builds fail:
1. Verify repository is set to PUBLIC in ECR Public console
2. Check image URI is correct in Amplify console
3. Ensure image was pushed successfully
4. Check CloudWatch logs for detailed error messages