# Local Setup

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Conda](https://docs.conda.io/en/latest/miniconda.html) (Miniconda or Anaconda)
- [PostgreSQL](https://www.postgresql.org/) running locally on port 5432

---

## 1. Database

Ensure PostgreSQL is running and the user/database exist:

```bash
psql -U postgres -c "CREATE USER <user_name>;"
psql -U postgres -c "CREATE DATABASE postgres OWNER <user_name>;"
```

Adjust the user and database name to match your `DB_USER` / `DB_NAME` env vars.

---

## 2. Frontend (Remix + Vite)

```bash
cd client
npm install ### only execute this the first time and when a new dependency is added.
mv ../downloadStream.js ./node_modules/@tapis/tapisui-api/dist/files/downloadStream.js ### perform this action only and every time you run npm install
npm run dev
```

Runs on **http://localhost:5174**

---

## 3. Backend (Flask)

### Create and activate the conda environment

```bash
conda env create -f labeler_env.yaml
conda activate smart-labeler
```

### Set environment variables

```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=postgres
export DB_USER=<your-pg-username>
export DB_PASSWORD=<your-pg-password>
export PATRA_BASE_NEW=https://patrabackend.pods.icicleai.tapis.io
export SMART_LABELER_CLASS_SUPPORT_IMAGE=https://icicleai.tapis.io/v3/files/postits/redeem/9cfc427e-8def-4c5c-ad6a-13d98d81ded8-010
export SMART_LABELER_PROPOSAL_GENERATION_IMAGE=https://icicleai.tapis.io/v3/files/postits/redeem/762971ed-6e1d-488d-81b1-da9f79369459-010
export SMART_LABELER_CLASSIFICATION_IMAGE=https://icicleai.tapis.io/v3/files/postits/redeem/105f43ed-04f1-4781-bd8c-0936c43e612e-010
```

### Start the server

```bash
cd server
python flask_server.py
```

Runs on **http://localhost:11112**

---

## 4. Install Tapis UI

Clone the repository:

```bash
git clone https://github.com/tapis-project/tapis-ui.git
cd tapis-ui
```

Install `pnpm` if you don't have it:

```bash
npm install -g pnpm
```

Run the init script (creates `.env` from template, installs deps, builds packages, and starts the dev server):

```bash
pnpm init-project
```

Add this in .env folder.
```t
VITE_SERVERLESS_DEPLOYMENT = "false"
VITE_TAPIS_BASE_URL = "https://icicleai.tapis.io"
```

Runs on **http://localhost:3000**

#### Other useful commands

```bash
pnpm run dev    # hot-reloading dev server
pnpm run start  # dev server without hot-reloading
```

Alter line number 14, in packages/icicle-tapisui-extension/src/pages/SmartDetection/SmartDetection.tsx
```
// src={`https://smartlabeler.pods.icicleai.tapis.io/`}
src={`http://localhost:5173/`}
```
