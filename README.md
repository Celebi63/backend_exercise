# Stock Market Engine

A backend system simulating a simplified stock exchange. Built to demonstrate high availability, fault tolerance, and concurrency control.

## Architecture & Tech Stack

The project implements a 3-tier distributed architecture:

* **Load Balancer:** Nginx routes incoming HTTP traffic across multiple backend instances using a round-robin algorithm.
* **Application Layer:** Two stateless Node.js (Express & TypeScript) instances.
* **State Management & Locking:** Redis is used as the single source of truth for wallet and bank states. To prevent race conditions and double-spending during concurrent requests, the system implements distributed locks via the `redlock` algorithm.

## Prerequisites

* Docker
* Docker Compose
* Node.js (for local test execution)

## Running Locally

The entire environment (Nginx, Node apps, Redis) is containerized. To spin it up, run:

```bash
PORT=4000 docker-compose up --build
```
The API will be accessible at http://localhost:4000.

Testing
The repository includes automated integration tests (Jest + Supertest) covering happy paths, validation errors, and a concurrent race condition simulation (10 simultaneous buy requests for limited stock).

To run the tests:

```bash
npm install
npm test
```

Core Endpoints
POST /wallets/{id}/stocks/{name} - Buy or sell a stock

GET /wallets/{id} - Get wallet details

GET /stocks - Get bank's stock inventory

POST /stocks - Overwrite bank inventory

POST /chaos - Force-kills the handling Node.js process (used to verify Nginx failover routing)

License
MIT
