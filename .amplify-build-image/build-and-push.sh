#!/bin/bash

# Build and push custom Amplify build image to Amazon ECR Public
# Usage: ./build-and-push.sh <your-ecr-public-alias> [repo-name]

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <your-ecr-public-alias> [repo-name]"
    echo "Example: $0 myalias amplify-agentcore-build"
    echo ""
    echo "Steps to get your ECR Public alias:"
    echo "1. Go to https://gallery.ecr.aws/"
    echo "2. Click 'Create repository'"
    echo "3. Set repository name and visibility to PUBLIC"
    echo "4. Your alias will be shown in the repository URI"
    exit 1
fi

ECR_ALIAS=$1
REPO_NAME=${2:-amplify-agentcore-build}
IMAGE_URI="public.ecr.aws/$ECR_ALIAS/$REPO_NAME:latest"

echo "🔨 Building custom Amplify build image..."
docker build -t $REPO_NAME .

echo "🔐 Authenticating to ECR Public (us-east-1 region)..."
aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws

echo "🏷️  Tagging image for ECR Public..."
docker tag $REPO_NAME:latest $IMAGE_URI

echo "📤 Pushing image to ECR Public..."
docker push $IMAGE_URI

echo ""
echo "✅ Image pushed successfully!"
echo "📋 Use this image URI in Amplify console:"
echo "   $IMAGE_URI"
echo ""
echo "⚠️  Important: Make sure the repository is set to PUBLIC in ECR Public console"
echo "   Visit: https://gallery.ecr.aws/ to verify"