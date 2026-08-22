# Multi-Client Architecture Setup Guide

This guide details the recommended architectural approaches for installing and managing the **BioAttendance** system across multiple clients, supporting both **Cloud (SaaS)** and **Local (On-Premise)** setups.

---

## Architecture Overview

By implementing the dynamic server configurations in the mobile app, you have created a **single, unified codebase** that can serve any client scenario.

```mermaid
graph TD
    subgraph Client 1 (Cloud Setup)
        A1[Flutter Mobile Client] -->|Connects to| B1[Vercel Backend Server]
        B1 -->|Stores in| C1[Supabase Cloud DB]
        D1[Biometric Device] -->|Communicates with| E1[Shared/Dedicated Cloud ADMS VM]
        E1 -->|Pushes logs| B1
    end

    subgraph Client 2 (Local Setup)
        A2[Flutter Mobile Client] -->|Connects to| B2[Local bio-backend.exe]
        B2 -->|Stores in| C2[Local PostgreSQL DB]
        D2[Biometric Device] -->|Communicates with| E2[Local bio-adms.exe]
        E2 -->|Pushes logs| B2
    end
```

---

## 1. Cloud-Based Scaling (SaaS Model)

Best for clients who want zero-maintenance setup, remote access (employees check records from home/field), and real-time off-site monitoring.

| Component | Scaling Strategy | Setup Details |
| :--- | :--- | :--- |
| **Database** | **Supabase Project Isolation** | Create a separate free-tier Supabase project for each client. This guarantees data privacy, security compliance, and isolates usage metrics. |
| **Backend API** | **Vercel Deployments** | Deploy a separate backend endpoint instance on Vercel for each client. Link each deployment to that client's specific Supabase database password in environment variables. |
| **ADMS Server** | **Multi-Tenant Server** | You can host **one single ADMS Server VM** in the cloud to manage all devices from all clients, because the server handles commands and logs strictly using the unique `device_code` (Serial Number) of the hardware. Or deploy one free-tier Oracle Cloud VM per client for performance isolation. |
| **Mobile App** | **Single Build** | Compile one APK. When a client opens the app, they connect to their designated Vercel backend URL by default. |

> [!TIP]
> Keep a master catalog mapping each client's unique biometric device Serial Numbers to their respective backend URLs. This makes troubleshooting extremely easy.

---

## 2. Local-Based Scaling (On-Premise Model)

Best for clients who want to pay a **one-time license fee**, have low/unstable internet connection in their offices, or want their data kept strictly inside their building.

| Component | Scaling Strategy | Setup Details |
| :--- | :--- | :--- |
| **Database** | **Local PostgreSQL** | Install PostgreSQL locally on the client's primary desktop or local server machine. Create a database called `postgres` and run the `setup-db.js` script to generate all schemas automatically. |
| **Backend API** | **`bio-backend.exe`** | Place the executable in a directory on the local server. Configure the `.env` file with the local database credentials. |
| **ADMS Server** | **`bio-adms.exe`** | Run the ADMS executable on port `8081` on the same server. Point the biometric device's ADMS settings to the server's local IP (e.g., `192.168.1.150:8081`). |
| **Mobile App** | **Settings Override** | Instruct the client to install the standard APK, open **Settings**, switch the mode to **Local/Custom Server**, and enter their local server's IP addresses (e.g. `http://192.168.1.150:3000` and `http://192.168.1.150:8081`). |

---

## Recommended Deployment Checklist

### Step 1: Client Onboarding
1. Ask the client: **"Do you want Cloud hosting (monthly subscription) or Local hosting (one-time license)?"**
2. Obtain the **Serial Numbers** of their biometric devices.

### Step 2: Cloud Client Setup
* Create a Supabase Database.
* Deploy the Backend to Vercel and input the Database credentials.
* Register their device Serial Numbers on the ADMS server mapping table.
* Distribute the APK (default cloud configuration).

### Step 3: Local Client Setup
* Install PostgreSQL on their main office PC/server.
* Copy the `bio-backend.exe` and `bio-adms.exe` binaries onto that computer.
* Create a `.env` file containing local database passwords and run the server binaries.
* Direct the biometric device's ADMS connection IP to the server PC.
* Install the APK on the manager's phone and configure the local IPs in the Settings page.
