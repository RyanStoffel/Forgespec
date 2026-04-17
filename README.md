# Forgespec

An AI-powered PC building and benchmark analysis platform built on Google Cloud Platform.

## Overview

Forgespec helps PC enthusiasts build better systems by combining part selection, real-time compatibility checking, AI-driven bottleneck analysis, and benchmark validation into a single platform. Users search and select components across all major categories (CPU, GPU, RAM, storage, motherboard, PSU, case, and cooler), and the system validates compatibility as the build is assembled. Once finalized, Gemini analyzes the build for bottlenecks and suggests better-value alternatives at the same price point. Users can also upload benchmark screenshots for the AI to compare actual performance against expected results for their hardware configuration.

## Team

- Ryan Stoffel
- Payton Henry

## Architecture

### Cluster 1: Edge and Authentication

Users authenticate through Firebase Auth using email/password or Google OAuth. A Firebase JWT is included in every request header. API Gateway validates the token on every inbound request before forwarding traffic to any Cloud Run service. Requests without a valid token are rejected with a 401 status code. B2B access is supported through API Gateway API key validation as an alternative authentication method.

### Cluster 2: Reactive Pipelines

Two non-HTTP event triggers drive the processing pipeline. When a user uploads a benchmark screenshot to Cloud Storage, Eventarc detects the new file and triggers the benchmark processing pipeline. When a build is finalized and written to Firestore, a Pub/Sub message is published and fans out to the bottleneck analysis worker and the value optimization worker in parallel, implementing a one-to-many distribution pattern.

### Cluster 3: Intelligence and Compute

Three dedicated Cloud Run services handle AI workloads:

1. **Compatibility and Bottleneck Analyzer** -- Takes the full build spec and returns a structured JSON report of performance bottlenecks and suggested component swaps.
2. **Benchmark Analyzer** -- Accepts a screenshot, extracts performance numbers via Gemini vision, and compares them against expected values for the user's build.
3. **Value Optimizer** -- Proposes alternative parts at the same budget with better price-to-performance ratios.

Cloud Functions serve as lightweight connectors, triggering Pub/Sub on build finalization and routing Eventarc events from Cloud Storage to the appropriate Cloud Run service.

### Cluster 4: Secure Orchestration

All credentials are stored in Secret Manager and fetched at runtime, including the Google AI API key and Firebase Admin SDK credentials. Each Cloud Run service and Cloud Function has its own dedicated service account with least-privilege role bindings. Cloud Scheduler triggers a nightly Cloud Function that scrapes updated part pricing and upserts the Firestore parts catalog.

### Cluster 5: Persistence and State

Firestore stores four top-level collections:

- **parts** -- Full seeded parts catalog, refreshed nightly. Fields: name, category, price, specs, url, updatedAt.
- **users/{uid}/builds** -- Saved build configurations and AI analysis results. Fields: buildId, parts map, status, analysisResult, createdAt. Composite index on uid + createdAt DESC.
- **users/{uid}/benchmarks** -- Uploaded benchmark results and comparisons. Fields: benchmarkId, buildId, uploadUrl, status, result, uploadedAt. Composite index on uid + uploadedAt DESC.
- **metrics/global** -- Platform-wide counters using FieldValue.increment() to prevent race conditions.

### Cluster 6: Frontend

The React frontend is containerized and served from Cloud Run. Three primary user-facing flows are exposed: the Build Builder (part search, selection, and real-time compatibility feedback), the Build Analysis view (bottleneck report and suggested alternatives), and the Benchmark Upload view (drag-and-drop screenshot upload with real-time processing status via Firestore onSnapshot listeners).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /parts?category={category}&search={query} | Search the parts catalog |
| POST | /builds | Save or finalize a build, triggers AI analysis pipeline |
| GET | /builds/{buildId} | Retrieve a saved build and its analysis result |
| POST | /benchmarks | Upload a benchmark screenshot, triggers benchmark pipeline |
| GET | /benchmarks/{benchmarkId} | Retrieve benchmark comparison result |

All requests require an `Authorization: Bearer {jwt}` header. Responses use standard JSON with appropriate HTTP status codes (200, 201, 400, 401, 403, 404, 500).

## Service Accounts

| Service Account | Purpose |
|-----------------|---------|
| sa-api-gateway | Invokes Cloud Run API services |
| sa-build-api | Reads/writes Firestore builds, publishes to Pub/Sub, writes to Cloud Storage |
| sa-benchmark-api | Reads/writes Firestore benchmarks, writes to Cloud Storage |
| sa-bottleneck-analyzer | Reads Firestore builds, reads Secret Manager, calls Gemini API, writes Firestore |
| sa-benchmark-analyzer | Reads Cloud Storage, reads Secret Manager, calls Gemini API, writes Firestore |
| sa-value-optimizer | Reads Firestore parts and builds, reads Secret Manager, calls Gemini API, writes Firestore |
| sa-refresh-parts | Reads Cloud Storage, writes Firestore parts collection, reads Secret Manager |

## Secrets

| Secret Name | Accessed By |
|-------------|-------------|
| google-ai-api-key | sa-bottleneck-analyzer, sa-benchmark-analyzer, sa-value-optimizer |
| firebase-admin-sdk | sa-build-api, sa-benchmark-api |

## Data Flow

**Build Analysis Pipeline:**
React frontend POST /builds -> API Gateway -> build-api Cloud Run -> Firestore write -> Pub/Sub publish -> fan-out to bottleneck-analyzer and value-optimizer -> results written back to Firestore -> frontend onSnapshot listener updates UI.

**Benchmark Upload Pipeline:**
React frontend POST /benchmarks -> API Gateway -> benchmark-api Cloud Run -> file stored in Cloud Storage -> Eventarc trigger -> benchmark-analyzer Cloud Run -> Gemini vision analysis -> results written to Firestore -> frontend onSnapshot listener updates UI.

**Nightly Refresh:**
Cloud Scheduler -> refresh-parts Cloud Function -> scrapes updated part pricing -> upserts Firestore parts collection.

## Security

- No default compute service accounts are used. Every service has a custom service account with granular, least-privilege role bindings.
- No service account has Owner or Editor roles.
- API Gateway enforces JWT validation on every inbound request.
- Firestore security rules enforce that users can only read and write documents matching their authenticated UID.
- All API keys and credentials are stored in Secret Manager and fetched at runtime. Secrets are never written to environment variables, code, or configuration files.
- Secret versions are pinned to prevent rotation from causing unexpected failures.

## Tech Stack

- **Frontend:** React (containerized on Cloud Run)
- **Authentication:** Firebase Auth (email/password, Google OAuth)
- **API Gateway:** Google Cloud API Gateway
- **Compute:** Cloud Run, Cloud Functions
- **AI:** Gemini (Google AI API)
- **Database:** Firestore
- **Storage:** Cloud Storage
- **Messaging:** Pub/Sub, Eventarc
- **Secrets:** Secret Manager
- **Scheduling:** Cloud Scheduler
