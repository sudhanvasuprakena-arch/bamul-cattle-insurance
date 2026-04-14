# BAMUL Cattle Insurance Platform

Monorepo for the BAMUL Cattle Insurance mobile application and backend services.

## Structure

```
bamul-cattle-insurance/
├── mobile/                      # Flutter app (Very Good CLI — com.bamul)
├── services/
│   ├── bamul-app-api/           # Main REST API (FastAPI, Python 3.12)
│   └── bamul-ai-service/        # Muzzle AI inference (FastAPI + PyTorch + FAISS)
├── packages/
│   ├── shared-lib/              # Shared Python: Pydantic models, auth utilities
│   ├── capture_orchestrator/    # Dart package: camera capture pipeline
│   └── barcode_scanner_adapter/ # Dart package: barcode scanner abstraction
├── infrastructure/              # AWS CDK (TypeScript) — ECS, RDS, S3, VPC
└── docs/                        # Architecture + API docs
```

## Prerequisites

- Flutter 3.41+ with Dart 3.3+
- Python 3.12 (via `uv`)
- Node.js 20+ with npm
- Docker + Docker Compose
- AWS CDK CLI (`npm install -g aws-cdk`)

## Quick Start

```bash
# Backend services (local dev)
cp .env.example .env          # fill in local dev values
docker compose up

# Flutter mobile app
cd mobile
flutter pub get
flutter run --flavor development
```

## AWS Region

All infrastructure deployed to `ap-south-1` (Mumbai) — DPDP Act 2023 compliance requirement.
