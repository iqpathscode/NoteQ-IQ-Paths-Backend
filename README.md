# NoteQ — Backend

> Role-based Notesheet Management & Approval Workflow System
> Built with Node.js · Express · MongoDB · Deployed on Render

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express)](https://expressjs.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?logo=mongodb)](https://www.mongodb.com)
[![Deployed on Render](https://img.shields.io/badge/Deployed-Render-46E3B7?logo=render)](https://render.com)

---

## What is NoteQ?

NoteQ is a backend API for managing **notesheets** — internal documents that go through a structured approval chain in academic or administrative institutions.

It handles:
- Role-based login and session management
- Creating and routing notesheets through approval workflows
- Actions like Forward, Approve, Reject, Query, and Close
- Email notifications, file attachments, and PDF/ZIP exports
- Admin controls for users, roles, departments, and schools

---

## Quick Start

### Step 1 — Prerequisites

Make sure you have these installed:

| Tool | Version | Link |
|---|---|---|
| Node.js | v18+ | [nodejs.org](https://nodejs.org) |
| npm | v9+ | Comes with Node.js |
| MongoDB | Any | [Local](https://www.mongodb.com/) or [Atlas](https://www.mongodb.com/atlas) |
| Git | Any | [git-scm.com](https://git-scm.com) |

You also need accounts on:
- [Cloudinary](https://cloudinary.com) — for file storage
- [SendGrid](https://sendgrid.com) — for email notifications

---

### Step 2 — Clone & Install

```bash
git clone https://github.com/your-username/noteq-backend.git
cd noteq-backend
npm install
```

---

### Step 3 — Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Then fill in the values:

```env
# Server
PORT=5000
NODE_ENV=development

# MongoDB
MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/noteq

# JWT
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=7d

# Cookie
COOKIE_EXPIRES_IN=7

# Frontend URL (for CORS and email links)
CLIENT_URL=http://localhost:5173

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# SendGrid
SENDGRID_API_KEY=your_sendgrid_api_key
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
```

> **Never commit your `.env` file.** It is already in `.gitignore`.

---

### Step 4 — Run the Server

```bash
# Development (auto-restarts on changes)
npm run dev

# Production
npm start
```

Server starts at: `http://localhost:5000`

---

## Project Structure

```
backend/
├── controllers/
│   ├── auth.controller.js          # Login, signup, password, profile
│   ├── notesheet.controller.js     # Notesheet CRUD and workflow
│   ├── admin.controller.js         # Users, roles, departments, schools
│   ├── notification.controller.js
│   └── download.controller.js      # PDF and ZIP export
├── middleware/
│   ├── auth.middleware.js          # JWT verification
│   └── admin.middleware.js         # Admin-only guard
├── models/                         # Mongoose schemas (see Data Models)
├── routes/
│   ├── auth.routes.js
│   └── upload.routes.js
├── utils/
│   ├── sendEmail.js                # SendGrid helper
│   ├── cloudinary.js               # Cloudinary config
│   └── generatePDF.js              # PDFKit helper
├── server.js                       # App entry point
└── package.json
```

---

## API Reference

All routes are prefixed with `/api/auth` unless noted.
Protected routes require a valid JWT cookie (set on login).

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | Public | Login |
| POST | `/api/auth/signup` | Public | Create account |
| GET | `/api/auth/me` | Protected | Get current user |
| POST | `/api/auth/logout` | Protected | Logout |
| PUT | `/api/auth/change-password` | Protected | Change password |
| POST | `/api/auth/forgot-password` | Public | Send reset email |
| POST | `/api/auth/reset-password/:token` | Public | Reset with token |

### Profile & Role

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/auth/profile` | Protected | Get profile (with signature) |
| PUT | `/api/auth/update-profile` | Protected | Update profile and signature |
| PUT | `/api/auth/role/switch-role` | Protected | Switch active role |

### Notesheet Operations

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/notesheet` | Protected | Create a notesheet |
| GET | `/api/auth/notesheets` | Protected | List notesheets (with filters) |
| GET | `/api/auth/notesheets/recent` | Protected | Dashboard recent notesheets |
| GET | `/api/auth/notesheets/received` | Protected | Received by current role |
| GET | `/api/auth/notesheets/employee` | Protected | Created by current user |
| GET | `/api/auth/notesheets/scope` | Protected | Within role's view scope |
| GET | `/api/auth/notesheets/processed` | Protected | Processing history |
| GET | `/api/auth/notesheets/:noteId` | Protected | Single notesheet details |
| GET | `/api/auth/notesheets/:noteId/approval-flow` | Protected | Full approval history |
| GET | `/api/auth/notesheets/:noteId/queries` | Protected | All queries on notesheet |

### Notesheet Actions

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| PUT | `/api/auth/notesheets/:noteId/approve-direct` | Protected | Approve (direct mode) |
| PUT | `/api/auth/notesheets/:noteId/approve-chain` | Protected | Approve (chain mode) |
| PUT | `/api/auth/notesheets/:noteId/forward-direct` | Protected | Forward (direct mode) |
| PUT | `/api/auth/notesheets/forward` | Protected | Forward (chain mode) |
| PUT | `/api/auth/notesheets/:noteId/reject` | Protected | Reject |
| PUT | `/api/auth/notesheets/:noteId/query` | Protected | Raise a query |
| PUT | `/api/auth/notesheets/:noteId/reply-query` | Protected | Reply to a query |
| PUT | `/api/auth/notesheets/:noteId/close` | Protected | Close (approving authority only) |

### Admin — Users

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/admin` | Admin | Create admin account |
| POST | `/api/auth/admin/create-user` | Admin | Create single employee |
| POST | `/api/auth/bulk-upload` | Admin | Bulk import via Excel |
| GET | `/api/auth/employees` | Admin | All employees |
| GET | `/api/auth/employee/:empId` | Admin | Single employee details |
| GET | `/api/auth/employee/:empId/notesheets/summary` | Admin | Employee notesheet summary |

### Admin — Schools, Departments, Powers, Roles

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST/GET/DELETE | `/api/auth/school` | Admin/Protected | School management |
| POST/GET/DELETE | `/api/auth/department` | Admin/Protected | Department management |
| POST/GET/PUT/DELETE | `/api/auth/power` | Admin/Protected | Power levels |
| POST/GET/DELETE | `/api/auth/role` | Admin/Protected | Role management |
| GET | `/api/auth/roles/eligible` | Protected | Roles eligible for forwarding |
| POST | `/api/auth/assign-power` | Admin | Assign power to role |
| POST | `/api/auth/assign-role` | Admin | Assign role to employee |
| POST | `/api/auth/assign-dept-role` | Admin | Department-role mapping |
| PUT | `/api/auth/transfer-role` | Admin | Transfer role between employees |

### Exports & Notifications

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/auth/notesheets/download/:id` | Protected | Download notesheet as PDF |
| POST | `/api/auth/notesheets/bulk-download` | Protected | Bulk download as ZIP |
| POST/GET/DELETE | `/api/auth/notifications` | Protected | Notification management |
| POST | `/api/upload` | Protected | Upload file to Cloudinary |

---

## How the Workflow Works

```
Created
   │
   ▼
Pending (at authority)
   │
   ├──► Forwarded ──► Pending (next authority)
   │
   ├──► Query ──► Query Reply ──► Pending (resumes)
   │
   ├──► Rejected  ← terminal
   │
   └──► Approved
            │
            ▼
         Closed  ← only the approving authority can close
```

**Two routing modes:**
- **Direct Mode** — sender picks a specific target role
- **Chain Mode** — notesheet moves through the hierarchy based on `power_level` configuration

Every action (create, forward, approve, reject, query, reply, close) is recorded in `NotesheetFlow` for full auditability.

---

## Key Features

**Parent-Child Notesheets** — Link a new notesheet to an existing approved/closed one for follow-up requests or budget continuations. Pass `parentNotesheet` reference ID on creation.

**Signature on Actions** — Users upload a signature image via profile update. It gets attached to every `NotesheetFlow` record they create.

**Receive Time Tracking** — When a notesheet reaches an authority, `receivedAt` is timestamped automatically.

**Email Notifications** — The notesheet creator gets an email via SendGrid when their notesheet is approved, rejected, or closed.

**Bulk User Import** — Admins can import multiple employees at once via an Excel file (`POST /api/auth/bulk-upload`).

---

## Tech Stack

| Technology | Purpose |
|---|---|
| Node.js (v18+) | Runtime |
| Express 5 | Web framework |
| MongoDB + Mongoose | Database and ODM |
| JWT + cookie-parser | Auth and sessions |
| bcryptjs | Password hashing |
| Cloudinary | File storage |
| SendGrid | Email notifications |
| multer | File upload middleware |
| PDFKit | PDF export |
| archiver | ZIP export |
| xlsx | Excel parsing for bulk import |

---

## Deployment (Render)

1. Push your code to GitHub
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your repository and configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add all environment variables from `.env.example`
5. Click **Deploy**

Make sure `CLIENT_URL` matches your frontend URL exactly (no trailing slash):

```env
CLIENT_URL=https://your-frontend.vercel.app
```

---

## Contributing

```bash
# 1. Fork and clone the repo
git checkout -b feature/your-feature-name

# 2. Make your changes, then commit
git commit -m "feat: describe your change"

# 3. Push and open a Pull Request
git push origin feature/your-feature-name
```

---

## License

Proprietary software — developed by **IQ Paths**.
Unauthorized copying, distribution, or modification is not permitted.

---

*Node.js + Express + MongoDB | Deployed on Render*
