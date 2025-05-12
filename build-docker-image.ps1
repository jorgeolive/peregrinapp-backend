# PowerShell script to build the PeregrinApp Backend Docker image
param (
    [string]$tag = "latest"
)

# Display information
Write-Host "Building PeregrinApp Backend Docker image with tag: $tag" -ForegroundColor Cyan

# Check if Dockerfile exists
if (-not (Test-Path "Dockerfile")) {
    Write-Host "Error: Dockerfile not found in the current directory." -ForegroundColor Red
    exit 1
}

# Build the Docker image
try {
    Write-Host "Building Docker image..." -ForegroundColor Yellow
    docker build -t peregrinappbackend:$tag .
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Successfully built peregrinappbackend:$tag" -ForegroundColor Green
    } else {
        Write-Host "Failed to build Docker image. Exit code: $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
} catch {
    Write-Host "An error occurred while building the Docker image: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nYou can now run the application using docker-compose:" -ForegroundColor Cyan
Write-Host "docker-compose up -d" -ForegroundColor Yellow 