# Multi-Client Architecture Setup Guide

This guide details the recommended architectural approaches for installing and managing the **BioAttendance** system across multiple clients, supporting both **Cloud (SaaS)** and **Local ADMS (On-Premise)** setups.

---

## Architecture Overview

By implementing the dynamic ADMS configurations in the mobile app, you have created a **single, unified codebase** where the backend API remains securely in the cloud, while the biometric device data transfer can run either globally (Cloud) or locally (On-Premise) based on local network constraints.

```mermaid
graph TD
    subgraph Client 1 (Fully Cloud Setup)
        A1[Flutter Mobile Client] -->|Connects to| B1[Vercel Backend Server]
        B1 -->|Stores in| C1[Supabase Cloud DB]
        D1[Biometric Device] -->|Communicates with| E1[Cloud ADMS Server VM]
        E1 -->|Pushes logs| B1
    end

    subgraph Client 2 (Cloud Backend + Local ADMS Setup)
        A2[Flutter Mobile Client] -->|Connects to| B1[Vercel Backend Server]
        D2[Biometric Device] -->|Communicates with| E2[Local bio-adms.exe]
        E2 -->|Pushes logs| B1
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

## 2. Local ADMS Scaling (On-Premise Model)

Best for clients who want to run the biometric reader on their local office network (without opening firewall ports to the public web), but still want the convenience of hosting the database and mobile APIs securely on the cloud.

| Component | Scaling Strategy | Setup Details |
| :--- | :--- | :--- |
| **Database** | **Supabase Cloud DB** | Hosted in the cloud (Supabase) for zero local database corruption risks and easy backup management. |
| **Backend API** | **Vercel Backend** | Always hosted on the cloud (Vercel) to ensure managers can check logs and reports from anywhere on their phones. |
| **ADMS Server** | **`bio-adms.exe` (Local)** | Run the compiled ADMS executable on port `8081` on a local Windows PC inside the office. Point the biometric device's ADMS settings to that PC's local IP (e.g. `192.168.1.150:8081`). |
| **Mobile App** | **ADMS Mode Override** | Install the standard APK, open **Settings**, switch **ADMS Mode** to **Local ADMS Server**, and enter the local server's IP address (e.g. `http://192.168.1.150:8081`). |

---

## Recommended Deployment Checklist

### Step 1: Client Onboarding
1. Ask the client: **"Do you want to run the Biometric device server locally inside your office network, or in the cloud?"**
2. Obtain the **Serial Numbers** of their biometric devices.

### Step 2: Fully Cloud Client Setup
* Create a Supabase Database.
* Deploy the Backend to Vercel and input the Database credentials.
* Register their device Serial Numbers on the ADMS server mapping table.
* Distribute the APK (default cloud configuration).

### Step 3: Local ADMS Client Setup
* Create a Supabase Database and deploy Backend to Vercel.
* Copy the `bio-adms.exe` binary onto their office PC.
* Create a `.env` file containing the Supabase DB password and run the local `bio-adms.exe` server.
* Direct the biometric device's ADMS connection IP to the office PC's local IP.
* Install the APK on the manager's phone and configure the local ADMS IP in the Settings page.
