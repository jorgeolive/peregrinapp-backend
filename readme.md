# PeregrinApp Backend

## Development Setup

Start the project for local development:
```
npx nodemon index.js
```

## Docker Setup

### Building the Docker Image

You can build the Docker image using the provided PowerShell script:

```powershell
./build-docker-image.ps1
```

To specify a custom tag:

```powershell
./build-docker-image.ps1 -tag v1.0.0
```

### Running with Docker Compose

The application can be run using Docker Compose with all required services:

1. Create a `docker.env` file with your environment variables
2. Run the following command:

```
docker-compose up -d
```

This will start the following services:
- PostgreSQL with PostGIS extension
- GeoServer
- pgAdmin
- Redis
- PeregrinApp Backend

### Accessing the Services

- PeregrinApp Backend: http://localhost:3000
- pgAdmin: http://localhost:5050
- GeoServer: http://localhost:8080