#!/bin/bash

# Create ECR Public repository using AWS CLI
# Usage: ./create-ecr-repo.sh <repository-name>

set -e

REPO_NAME=${1:-amplify-agentcore-build}

echo "🏗️  Creating ECR Public repository: $REPO_NAME"

# Create the repository
aws ecr-public create-repository \
    --repository-name $REPO_NAME \
    --catalog-data description="Custom Amplify build image with Docker and Node.js pre-installed" \
    --region us-east-1

echo ""
echo "✅ Repository created successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Note your ECR Public alias from the output above"
echo "2. Run: ./build-and-push.sh <your-alias> $REPO_NAME"
echo "3. Use the resulting image URI in Amplify console"
echo ""
echo "🌐 View your repository at: https://gallery.ecr.aws/"