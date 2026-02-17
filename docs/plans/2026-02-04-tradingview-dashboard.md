# TradingView Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TradingView-based dashboard with a robust Data Source Management System supporting local DB, external URLs, and API subscriptions.

**Architecture:** Next.js (App Router) + Tailwind CSS frontend. SQLite + Prisma for data management. Lightweight Charts for visualization. Modular data adapter pattern for unified data access.

**Tech Stack:** Next.js 14, React, Tailwind CSS, Prisma, SQLite, tradingview/lightweight-charts, shadcn/ui (for admin interface).

---

## Phase 1: Foundation & Infrastructure

### Task 1: Project Initialization

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tailwind.config.ts`
- Create: `app/page.tsx`

**Step 1: Initialize Next.js Project**

Run: `npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*"`

**Step 2: Install Additional Dependencies**

Run: `npm install lightweight-charts prisma @prisma/client clsx tailwind-merge lucide-react`
Run: `npm install -D @types/node @types/react @types/react-dom`

**Step 3: Initialize Prisma**

Run: `npx prisma init --datasource-provider sqlite`

**Step 4: Verify Setup**

Run: `npm run build`
Expected: Build success

**Step 5: Commit**

```bash
git add .
git commit -m "chore: initialize project with nextjs, tailwind and prisma"
```

---

## Phase 2: Data Architecture

### Task 2: Database Schema Design

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Define Schema**

Add models for `DataSource` and `MarketData`.

```prisma
// prisma/schema.prisma

model DataSource {
  id          String   @id @default(uuid())
  name        String
  type        String   // "LOCAL_DB", "EXTERNAL_URL", "API_SUBSCRIPTION"
  config      String   // JSON string storing URL, API keys, etc.
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  isActive    Boolean  @default(true)
}

// For "LOCAL_DB" type sources
model MarketData {
  id          Int      @id @default(autoincrement())
  symbol      String
  timestamp   Int      // Unix timestamp
  open        Float
  high        Float
  low         Float
  close       Float
  volume      Float?
  sourceId    String? // Optional link to source
  
  @@index([symbol, timestamp])
}
```

**Step 2: Generate Migration**

Run: `npx prisma migrate dev --name init_schema`

**Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: define database schema for data sources"
```

### Task 3: Data Source Management API

**Files:**
- Create: `app/api/sources/route.ts`
- Create: `lib/db.ts`

**Step 1: Create Prisma Client Singleton**

Create `lib/db.ts` to prevent multiple Prisma instances in dev.

**Step 2: Create CRUD Endpoints**

Implement GET (list sources) and POST (create source) in `app/api/sources/route.ts`.

**Step 3: Test API**

(Manual test via curl or script, or unit test if environment permits)

**Step 4: Commit**

```bash
git add app/api/sources/route.ts lib/db.ts
git commit -m "feat: implement data source management api"
```

---

## Phase 3: Data Source Adapters

### Task 4: Unified Data Adapter Interface

**Files:**
- Create: `lib/adapters/types.ts`
- Create: `lib/adapters/index.ts`

**Step 1: Define Interface**

```typescript
// lib/adapters/types.ts
export interface Candle {
  time: number; // lightweight-charts expects unified time
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface DataAdapter {
  fetchData(config: any, symbol: string): Promise<Candle[]>;
}
```

**Step 2: Commit**

```bash
git add lib/adapters
git commit -m "feat: define data adapter interfaces"
```

### Task 5: Implement Concrete Adapters

**Files:**
- Create: `lib/adapters/local-db.ts`
- Create: `lib/adapters/external-url.ts`

**Step 1: Implement Local DB Adapter**

Query `MarketData` table via Prisma.

**Step 2: Implement External URL Adapter**

Fetch JSON from configured URL and map to `Candle` format.

**Step 3: Commit**

```bash
git add lib/adapters
git commit -m "feat: implement local and external data adapters"
```

### Task 6: Data Proxy API

**Files:**
- Create: `app/api/data/route.ts`

**Step 1: Implement Proxy Endpoint**

Accept `sourceId` and `symbol`.
Load Source config -> Select Adapter -> Fetch Data -> Return standard JSON.

**Step 2: Commit**

```bash
git add app/api/data/route.ts
git commit -m "feat: implement unified data proxy api"
```

---

## Phase 4: Frontend Implementation

### Task 7: Chart Component

**Files:**
- Create: `components/Chart.tsx`

**Step 1: Implement Lightweight Charts**

Create a React component wrapping `createChart`.
Accept `data` prop.
Handle resize observer.

**Step 2: Commit**

```bash
git add components/Chart.tsx
git commit -m "feat: implement lightweight charts component"
```

### Task 8: Data Source Management UI

**Files:**
- Create: `components/SourceManager.tsx`
- Create: `components/SourceForm.tsx`

**Step 1: List View**

Fetch and display sources from `/api/sources`.

**Step 2: Add/Edit Form**

Form to input Name, Type, and Config (JSON).

**Step 3: Commit**

```bash
git add components/SourceManager.tsx components/SourceForm.tsx
git commit -m "feat: implement data source management ui"
```

### Task 9: Dashboard Integration

**Files:**
- Modify: `app/page.tsx`

**Step 1: Layout**

Sidebar: Source Manager & Symbol Selector.
Main: Chart area.

**Step 2: State Management**

Selected Source -> Selected Symbol -> Fetch Data -> Update Chart.

**Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: integrate dashboard with chart and manager"
```

---

## Phase 5: Polish & Documentation

### Task 10: Error Handling & Loading States

**Files:**
- Modify: `components/Chart.tsx`
- Modify: `app/page.tsx`

**Step 1: Add Loading Spinners**

**Step 2: Add Error Toasts**

**Step 3: Commit**

```bash
git add .
git commit -m "feat: add error handling and loading states"
```

