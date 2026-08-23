# BioAttendance Biometric Integration Session Log
**Date**: August 22, 2026

This document records the chat transcript, changes made, and support guides compiled during our session.

---

## 1. Accomplishments & Solutions

### A. Automatic Biometric Sync & Mappings
* **Problem**: New employees created from the Flutter mobile app weren't mapped or pushed to the biometric device, causing punches to be skipped.
* **Solution**:
  1. Updated the Flutter app [`mobile/lib/main.dart`](file:///c:/Users/sveer/Desktop/BioAttendance/mobile/lib/main.dart)'s `saveEmployee` function to send a direct POST request to your Oracle Cloud ADMS server (`http://140.245.240.147:8081/api/adms/enqueue-command`) to queue the employee info (`DATA UPDATE USERINFO ...`).
  2. Updated the backend API [`backend/server.js`](file:///c:/Users/sveer/Desktop/BioAttendance/backend/server.js)'s `POST /employees` endpoint to automatically insert the required device association row into the `essl_employee_mapping` table.

### B. Biometric Punches Sync to Mobile App
* **Problem**: Scans from the device were saving to the `attendance` summary table, but the Flutter app was querying the `attendance_sessions` table to show history.
* **Solution**: Modified [`adms-server/index.js`](file:///c:/Users/sveer/Desktop/BioAttendance/adms-server/index.js) on the ADMS server to automatically write punch logs to **both** tables (`attendance` and `attendance_sessions`) upon receipt.

### C. Smart Auto-Toggle (IN / OUT)
* **Problem**: The physical ZKTeco device defaults all scans to `IN` (Check-In) unless the user manually toggles the screen. This prevented check-out recordings.
* **Solution**: Implemented auto-toggle logic in [`adms-server/index.js`](file:///c:/Users/sveer/Desktop/BioAttendance/adms-server/index.js):
  * When a punch is received as `IN`, the server checks for an open check-in session for today (`check_out IS NULL`).
  * If an open session already exists, it **automatically treats the punch as a Check-Out (`OUT`)** and closes the session.
  * If no open session exists, it starts a new Check-In (`IN`) session.
  * This allows logging multiple check-in/out sessions per day, calculating total inside-office hours, and excluding break times!

### D. App Report Key Mismatch
* **Problem**: The dashboard cards (sessions, hours) showed `0` due to a key mismatch (backend returned `daily_report`, Flutter client expected `sessions`).
* **Solution**: Updated [`backend/server.js`](file:///c:/Users/sveer/Desktop/BioAttendance/backend/server.js) to return both keys, instantly resolving the card calculations on the Flutter client.

### E. Split Repository Hosting
* **Requirement**: Split the unified repository so the backend and mobile apps can be hosted independently on Vercel/Netlify.
* **Solution**:
  1. Configured custom `.gitignore` exclusions in `backend/` to prevent committing logs/temp files.
  2. Initialized standalone Git repositories in both folders and pushed them to separate GitHub repositories:
     * **Backend**: `https://github.com/saikrishnanewdev/app_backend.git`
     * **Mobile**: `https://github.com/saikrishnanewdev/BioAttendance_flutter_app.git`

### F. Device Wipe & Database Clean Slate
* **Requirement**: Delete all test data and users to start clean.
* **Solution**:
  1. Wiped the physical device remotely by enqueuing `CLEAR DATA USERINFO`, `CLEAR DATA`, and `REBOOT` commands. The device successfully wiped its RAM and rebooted automatically.
  2. Wiped the Supabase database clean by executing:
     * `DELETE FROM employees;` (cascaded to mappings, sessions, and attendance summaries)
     * Truncated `essl_attendance_logs` and `adms_commands` history tables.

### G. Dynamic Local & Cloud Server Modes
* **Requirement**: Keep the main App Backend API server running stably in the cloud (Vercel), while allowing the ADMS server to toggle between local hosting (on the client's office network) and cloud hosting.
* **Solution**:
  1. Added an **ADMS Server Configuration** card in `SettingsScreen` that lets the admin choose between **Cloud ADMS (Default)** and **Local ADMS Server** (where they configure their **Local ADMS URL**, e.g., `http://192.168.0.100:8081`).
  2. The primary app backend API connection is locked to always use the Vercel cloud server (`https://appbackend-smoky.vercel.app`) to ensure stable employee management and reports.
  3. Saved choices persistently using `SharedPreferences` and updated in-memory ADMS connection URLs in real-time.
  4. Fixed startup crash on Android phones by making `MainActivity` inherit from `FlutterFragmentActivity`, matching parent layout styles to `Theme.AppCompat.Light.NoActionBar`, and applying the `org.jetbrains.kotlin.android` Kotlin compiler Gradle plugin in `build.gradle.kts` to compile the source code properly.

---

## 2. Command Reference Guide

### Running Windows executables locally (Recommended for Client)
We packaged both servers as standalone Windows `.exe` files. You can copy these files to the client machine and run them without installing Node.js:
1. **File Locations**:
   * **Backend server**: [`bio-backend.exe`](file:///c:/Users/sveer/Desktop/BioAttendance/backend/bio-backend.exe)
   * **ADMS server**: [`bio-adms.exe`](file:///c:/Users/sveer/Desktop/BioAttendance/adms-server/bio-adms.exe)
2. **Environment Variables**:
   * Create a `.env` file in the same folder as the `.exe` files.
   * Add the following parameters:
     ```env
     SUPABASE_DB_PASSWORD=Abs@project87456123
     PORT=3000   # (use 8081 for bio-adms.exe)
     ```
3. **Execution**: Double-click the `.exe` file to start the servers on their local ports!

### Running Dev Mode Locally
* **Backend API Server**:
  ```cmd
  cd C:\Users\sveer\Desktop\BioAttendance\backend
  npm start
  ```
* **Flutter Web Client (Chrome)**:
  ```cmd
  cd C:\Users\sveer\Desktop\BioAttendance\mobile
  C:\flutter\bin\flutter.bat run -d chrome --web-port=5000
  ```

### Pushing Git Updates Manually
* **Backend**:
  ```cmd
  cd C:\Users\sveer\Desktop\BioAttendance\backend
  git push -u origin main
  ```
* **Flutter Mobile**:
  ```cmd
  cd C:\Users\sveer\Desktop\BioAttendance\mobile
  git push -u origin main
  ```

### Updating your Oracle Cloud VM ADMS Server
Run these in your SSH terminal:
```bash
cd ~/adms-server
git pull origin main
sudo pm2 restart adms-server
```
