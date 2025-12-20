# PowerShell script for Windows to build and push to ECR Public
# Usage: .\build-and-push-windows.ps1 <your-ecr-public-alias> [repo-name]

param(
    [Parameter(Mandatory=$true)]
    [string]$EcrAlias,
    
    [Parameter(Mandatory=$false)]
    [string]$RepoName = "amplify-agentcore-build"
)

$ErrorActionPreference = "Stop"

$ImageUri = "public.ecr.aws/$EcrAlias/$RepoName`:latest"

Write-Host "�  Checking prerequisites..." -ForegroundColor Green

# Check if Docker is running
try {
    docker version | Out-Null
    Write-Host "✅ Docker is running" -ForegroundColor Green
} catch {
    Write-Error "❌ Docker is not running. Please start Docker Desktop and try again."
    exit 1
}

# Check if AWS CLI is configured
try {
    aws sts get-caller-identity | Out-Null
    Write-Host "✅ AWS CLI is configured" -ForegroundColor Green
} catch {
    Write-Error "❌ AWS CLI is not configured. Please run 'aws configure' first."
    exit 1
}

Write-Host "🔨 Building custom Amplify build image with Node.js 22..." -ForegroundColor Green
docker build -t $RepoName .

if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Failed to build Docker image"
    exit 1
}

Write-Host "� Gettinig ECR Public login token..." -ForegroundColor Green
$LoginToken = aws ecr-public get-login-password --region us-east-1

if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Failed to get ECR login token"
    exit 1
}

Write-Host "🔐 Logging into ECR Public..." -ForegroundColor Green
# Use echo to pipe the token to docker login (Windows-compatible)
echo $LoginToken | docker login --username AWS --password-stdin public.ecr.aws

if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Failed to login to ECR Public"
    exit 1
}

Write-Host "🏷️  Tagging image for ECR Public..." -ForegroundColor Green
docker tag "$RepoName`:latest" $ImageUri

Write-Host "📤 Pushing image to ECR Public..." -ForegroundColor Green
docker push $ImageUri

if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Failed to push image to ECR Public"
    exit 1
}

Write-Host ""
Write-Host "✅ Image pushed successfully!" -ForegroundColor Green
Write-Host "📋 Use this image URI in Amplify console:" -ForegroundColor Yellow
Write-Host "   $ImageUri" -ForegroundColor Cyan
Write-Host ""
Write-Host "📝 Next steps:" -ForegroundColor Yellow
Write-Host "   1. Go to your Amplify app in AWS Console" -ForegroundColor White
Write-Host "   2. Navigate to App settings > Build settings" -ForegroundColor White
Write-Host "   3. Click Edit on Build image settings" -ForegroundColor White
Write-Host "   4. Select Custom build image" -ForegroundColor White
Write-Host "   5. Enter the image URI above" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  Important: Make sure the repository is set to PUBLIC in ECR Public console" -ForegroundColor Yellow
Write-Host "   Visit: https://gallery.ecr.aws/ to verify" -ForegroundColor Yellow