# ⚡ Copilot Assistant Extension v1.2.3 - Log Access & Tool Guidelines

---

# 🚨🚨🚨 STOP - READ THIS FIRST 🚨🚨🚨

## ⛔ ABSOLUTELY FORBIDDEN - INSTANT FAILURE

### **YOU MUST NEVER, UNDER ANY CIRCUMSTANCES:**

1. **❌ USE TERMINAL COMMANDS TO START/STOP/RUN APPLICATIONS**
   - **NO `npm start`** - Use `copilotAssistant.start` instead
   - **NO `flutter run`** - Use `copilotAssistant.start` instead  
   - **NO `go run .`** - Use `copilotAssistant.start` instead
   - **NO `python app.py`** - Use `copilotAssistant.start` instead
   - **NO `node index.js`** - Use `copilotAssistant.start` instead
   - **NO `java -jar`** - Use `copilotAssistant.start` instead
   - **NO `mvn spring-boot:run`** - Use `copilotAssistant.start` instead

2. **❌ USE TERMINAL TO STOP/KILL APPLICATIONS**
   - **NO `pkill`** - Use `copilotAssistant.stop` instead
   - **NO `Stop-Process`** - Use `copilotAssistant.stop` instead
   - **NO `kill`** - Use `copilotAssistant.stop` instead

3. **❌ USE TERMINAL OR GREP TO SEARCH LOGS**
   - **NO `grep`** - Use `copilotAssistant.searchLogs` instead
   - **NO `Select-String`** - Use `copilotAssistant.searchLogs` instead
   - **NO `Get-Content`** - Use `copilotAssistant.searchLogs` instead

### **⚠️ CRITICAL CONSEQUENCE:**
If you use terminal commands for app control, **logs will NOT be captured**. You will be unable to analyze errors, debug issues, or help the user. The entire purpose of this extension is defeated.

### **✅ ALWAYS USE THESE EXTENSION COMMANDS:**
- **Get instances**: `run_vscode_command({ commandId: "copilotAssistant.getInstancesForCopilot" })` (required before start/stop/restart when an instance is expected)
- **Start instance (preferred)**: `run_vscode_command({ commandId: "copilotAssistant.startInstance", args: ["instanceId"] })` ⚠️ **MUST check compilation first**
- **Restart instance (preferred)**: `run_vscode_command({ commandId: "copilotAssistant.restartInstance", args: ["instanceId"] })` ⚠️ **MUST check compilation first**
- **Start app (fallback only)**: `run_vscode_command({ commandId: "copilotAssistant.start" })` (**ONLY** when no matching instance exists; this may prompt for a directory)
- **Stop instance**: `run_vscode_command({ commandId: "copilotAssistant.stopInstance", args: ["instanceId"] })`
- **Search instance logs**: `run_vscode_command({ commandId: "copilotAssistant.searchInstanceLogs", args: ["instanceId", "pattern"] })`

### **🧠 CRITICAL: MULTI-INSTANCE START RULE (ALL apps)**
If Copilot is asked to start a specific app/project (e.g. **"Start flutter app"**, **"Start node app"**, **"Start the backend"**), you MUST:
1) Fetch instances (`copilotAssistant.getInstancesForCopilot`)
2) Read `.copilot-assistant/instances.json`
3) Choose the matching instance by intent:
  - If user names a language: match `language` (e.g., `flutter`, `nodejs`, `go`, `java`, `python`)
  - If user names an app/project: match `name` and/or `projectRoot`
  - If exactly one instance exists: use it
  - If multiple plausible matches exist: ask the user which instance to start
4) Call `copilotAssistant.startInstance` with the instance ID

**NEVER** call `copilotAssistant.start` first if a matching instance exists — that forces the user to pick a directory.

### **🧠 CRITICAL: MULTI-INSTANCE RESTART RULE (ALL apps)**
If Copilot is asked to restart an app/project (e.g. **"Restart the app"**, **"Restart flutter"**, **"Restart the backend"**), you MUST:
1) Fetch instances (`copilotAssistant.getInstancesForCopilot`)
2) Read `.copilot-assistant/instances.json`
3) Choose the matching instance by intent (same matching rules as start)
4) Call `copilotAssistant.restartInstance` with the instance ID

**NEVER** call `copilotAssistant.start` for an existing instance during a restart request — that forces the user to pick a directory again.

**Note:** If an instance has never been started before, `restartInstance` may tell the user to run Start first. In that case, call `copilotAssistant.startInstance` using the same instance ID.

**Required workflow example (Flutter, but same pattern for any app):**
```typescript
run_vscode_command({
  commandId: "copilotAssistant.getInstancesForCopilot",
  name: "Get all instances"
});

read_file({
  filePath: "<workspace>/.copilot-assistant/instances.json",
  startLine: 1,
  endLine: 200
});

// Pick the matching instance:
// - If exactly 1 matching instance: use it
// - If multiple matching instances: ask the user which one
// - If none: fall back to copilotAssistant.start (directory picker)

run_vscode_command({
  commandId: "copilotAssistant.startInstance",
  name: "Start instance",
  args: [instanceId]
});
```

### **🔍 CRITICAL: PRE-START COMPILATION CHECK**
**BEFORE** executing `copilotAssistant.start`, `copilotAssistant.startInstance`, `copilotAssistant.restart`, or `copilotAssistant.restartInstance`, you **MUST**:
```typescript
// Step 1: Check for language server errors (fast check)
get_errors({})

// Step 2: If errors exist, DO NOT START - fix them first

// Step 3: Run actual compilation to catch build-time errors
// Detect language and use appropriate build command:

// Flutter/Dart:
run_in_terminal({
  // Run this in the Flutter project's root (use the instance's projectRoot when using startInstance)
  // Choose a build target appropriate for the OS (examples below).
  command: "flutter build windows --debug",  // e.g. flutter build macos --debug | flutter build ios --simulator | flutter build apk | flutter build web
  explanation: "Compile Flutter code to check for build-time errors",
  isBackground: false
})

// Node.js/TypeScript:
run_in_terminal({
  command: "npm run build",  // Or: tsc --noEmit, yarn build
  explanation: "Compile TypeScript/JavaScript code",
  isBackground: false
})

// Java (Maven):
run_in_terminal({
  command: "mvn compile",
  explanation: "Compile Java code with Maven",
  isBackground: false
})

// Java (Gradle):
run_in_terminal({
  command: "gradle build",
  explanation: "Compile Java code with Gradle",
  isBackground: false
})

// .NET/C#:
run_in_terminal({
  command: "dotnet build",
  explanation: "Compile .NET code",
  isBackground: false
})

// Go:
run_in_terminal({
  command: "go build",
  explanation: "Compile Go code",
  isBackground: false
})

// Rust:
run_in_terminal({
  command: "cargo build",
  explanation: "Compile Rust code",
  isBackground: false
})

// Python (syntax check only - no compilation needed):
run_in_terminal({
  command: "python -m py_compile **/*.py",
  explanation: "Check Python syntax",
  isBackground: false
})

// Step 4: Only if compilation succeeds AND no errors, then start/restart
run_vscode_command({ commandId: "copilotAssistant.start" })
```

**How to detect the language:**
- Check for `pubspec.yaml` → Flutter/Dart
- Check for `package.json` with `typescript` dep → TypeScript/Node.js
- Check for `pom.xml` → Java (Maven)
- Check for `build.gradle` → Java (Gradle)
- Check for `.csproj` or `.sln` → .NET/C#
- Check for `go.mod` → Go
- Check for `Cargo.toml` → Rust
- Check for `.py` files → Python

**Why this is critical:**
- `get_errors({})` only shows language server errors, NOT build-time errors
- Many languages have code generation and build-time checks not caught by language server
- Starting app with compilation errors wastes time and causes confusing logs
- Extension will capture error output but app won't actually run
- User will see misleading "app started" when it actually crashed immediately
- ALWAYS validate compilation BEFORE starting to ensure clean startup

### **💡 WHEN USER SAYS ANY OF THESE:**
- "start the app" / "run the app" / "launch the app"
- "run the server" / "start the server"
- "boot up" / "fire up" / "spin up"
- "get it running" / "make it run"
- "check logs" / "search logs" / "find errors"

### **👉 YOU MUST USE EXTENSION COMMANDS - NOT TERMINAL**

---

## 🚨 CRITICAL RULES - NEVER BREAK THESE

### **❌ NEVER USE TERMINAL COMMANDS FOR APP CONTROL**

**FORBIDDEN COMMANDS - DO NOT USE:**
```powershell
# ❌ NEVER DO THIS:
npm start
npm run dev
flutter run
go run .
python app.py
java -jar app.jar
mvn spring-boot:run
node index.js

# ❌ NEVER DO THIS EITHER:
npm stop
pkill -f "node"
Stop-Process -Name "flutter"
```

**WHY THIS IS CRITICAL:**
- Terminal commands bypass the extension's log capture system
- Logs won't appear in Copilot Assistant panel
- You won't be able to read or analyze logs
- The extension manages the application process lifecycle
- Only extension commands enable log streaming to Copilot

### **✅ ALWAYS USE EXTENSION COMMANDS FOR APP CONTROL**

**CORRECT - Use extension commands:**
```typescript
// Starting the app
run_vscode_command({
  commandId: "copilotAssistant.start",
  name: "Start the application"
})

// Stopping the app
run_vscode_command({
  commandId: "copilotAssistant.stop",
  name: "Stop the application"
})

// Restarting the app
run_vscode_command({
  commandId: "copilotAssistant.restart",
  name: "Restart the application"
})
```

**REMEMBER:** If the user asks to "start the app", "run the server", "launch the application", or similar - ALWAYS use `copilotAssistant.start` command. NEVER use terminal commands like `npm start` or `flutter run`.

---

## 🎯 Core Principle: Use The Right Tool for the Right Job

### **For Log Search Operations (ALWAYS use extension commands):**

**✅ CORRECT - Use extension search command (multi-instance safe):**
```typescript
// 1) Get instances so you can pick the right instance ID
run_vscode_command({
  commandId: "copilotAssistant.getInstancesForCopilot",
  name: "Get all instances"
})

read_file({
  filePath: "<workspace>/.copilot-assistant/instances.json",
  startLine: 1,
  endLine: 200
})

// 2) Search logs for a specific instance
run_vscode_command({
  commandId: "copilotAssistant.searchInstanceLogs",
  name: "Search instance logs for pattern",
  args: ["<instanceId>", "ERROR"]
})

// 3) Read the ENTIRE results file (use a large number like 10000 for endLine)
read_file({
  filePath: "<workspace>/.copilot-assistant/search-results-<instanceId>.txt",
  startLine: 1,
  endLine: 10000
})
```

**IMPORTANT:** When using `run_vscode_command`, always pass the search pattern as the FIRST element in the args array. The pattern should be a string, not wrapped in quotes within the array.

**❌ WRONG - Don't use terminal or grep_search:**
```powershell
# ❌ DON'T DO THIS:
Get-Content .copilot-assistant/app.log | Select-String "pattern"
grep_search({ query: "pattern", includePattern: ".copilot-assistant/app.log" })
```

**Why?**
- Extension command searches in-memory logs (up to 10,000 entries)
- Results written to `.copilot-assistant/search-results-{instanceId}.txt`
- No direct log file access needed
- Faster than file-based searching
- Works with live logs that aren't written to disk

**CRITICAL:** When reading `search-results-{instanceId}.txt`, ALWAYS use a large `endLine` value (like 10000) to ensure you read ALL results. Do NOT use `endLine: -1` as it may only read one line.

### **For Terminal Operations (Use run_in_terminal ONLY for non-app tasks):**

**✅ CORRECT - Use terminal ONLY for:**
- Build commands (`npm run build`, `flutter build apk`) - NOT running the app!
- Package management (`npm install`, `flutter pub get`, `pip install`)
- Git operations (`git commit`, `git status`, `git push`)
- File manipulation (`mkdir`, `cp`, `mv`, `rm`)
- AWS/Cloud operations (`aws s3 sync`, `aws cloudfront create-invalidation`)
- Database operations (`psql`, `mysql`)

**❌ ABSOLUTELY FORBIDDEN - NEVER use terminal for:**
- **Starting applications** (`npm start`, `flutter run`, `go run .`, `python app.py`)
- **Running applications** (`npm run dev`, `node index.js`, `java -jar app.jar`)
- **Stopping applications** (`pkill`, `Stop-Process`, `kill`)
- Reading/searching logs (use `copilotAssistant.searchLogs` command)
- Counting log entries (search then count results from `search-results-{instanceId}.txt`)
- Analyzing file content (use `read_file` or `semantic_search`)

**WHY:** Terminal-started apps bypass the extension's log capture. You won't be able to see or analyze logs!

---

## 📋 Log Search Workflow (Multi-Instance Support)

**CRITICAL: This extension supports multiple instances!**
- Each instance has its own isolated logs
- ALWAYS specify which instance you want to search
- Use `copilotAssistant.searchInstanceLogs` with the instance ID

**Search Results Files:**
- Per-instance: `.copilot-assistant/search-results-{instanceId}.txt`

### How It Works:
1. Extension keeps logs in memory per instance (up to 10,000 entries each)
2. You call `copilotAssistant.searchInstanceLogs` with instanceId and query
3. Extension searches that instance's in-memory logs
4. Results written to `.copilot-assistant/search-results-{instanceId}.txt`
5. You read the results file to analyze matches

### Getting Instance IDs:
Before searching logs, you MUST get the instance ID first:

**RECOMMENDED METHOD: Use getInstancesForCopilot command**
```typescript
// Step 1: Call the command to generate instances.json file
run_vscode_command({
  commandId: "copilotAssistant.getInstancesForCopilot",
  name: "Get all instances"
})

// Step 2: Read the generated file
read_file({
  filePath: "<workspace>/.copilot-assistant/instances.json",
  startLine: 1,
  endLine: 100
})

// The file contains JSON array with instance info:
// [
//   {
//     "id": "instance-1",
//     "name": "simple_flutter_app (Flutter)",
//     "projectRoot": "/path/to/project",
//     "language": "flutter",
//     "isRunning": true,
//     "logCount": 31
//   }
// ]
```

**ALTERNATIVE: Direct file read (if instances.json already exists)**
```typescript
// Instances are automatically written to file when created/removed
read_file({
  filePath: "<workspace>/.copilot-assistant/instances.json",
  startLine: 1,
  endLine: 100
})
```
grep_search({ query: "getAllInstances", includePattern: "src/extension.ts" })
```

Each instance has:
- **id**: Unique identifier (UUID format)
- **name**: Display name (project folder name)
- **projectRoot**: Absolute path to project directory
- **language**: Detected language (flutter, go, java, python, nodejs)
- **logService**: Isolated log service with separate logs

### Enhanced Log Format:
```
[2025-10-03T19:23:06.115Z] [ERROR] [npm] npm error Missing script | type=ConfigurationError severity=HIGH
[2025-10-03T19:23:06.120Z] [INFO] [Flutter] App started | severity=LOW
[2025-10-03T19:23:06.125Z] [WARN] [Memory] High usage | type=MemoryError severity=MEDIUM tags=performance
```

**Metadata Fields:**
- `type`: NetworkError, MemoryError, ConfigurationError, AuthenticationError, DatabaseError, FileSystemError, SyntaxError, RuntimeError
- `severity`: CRITICAL, HIGH, MEDIUM, LOW
- `tags`: performance, security, api, ui, data

---

## 📖 Common Query Examples (Copy These!)

### Searching Instance Logs (REQUIRED WORKFLOW)

**User: "check logs for errors"**
```typescript
// Step 1: Get the instance ID (you need to know which instance to search)
// The instance ID is usually provided by the user, or you can infer it from context
// For this example, assume we have instanceId = "abc-123-def-456"

const instanceId = "abc-123-def-456";  // Replace with actual instance ID

// Step 2: Search that instance's logs
run_vscode_command({
  commandId: "copilotAssistant.searchInstanceLogs",
  name: "Search instance logs for errors",
  args: [instanceId, "ERROR"]  // [instanceId, searchPattern]
})

// Step 3: Read the instance-specific results file
read_file({
  filePath: `<workspace>/.copilot-assistant/search-results-${instanceId}.txt`,
  startLine: 1,
  endLine: 10000  // Large number ensures all lines are read
})
```

**User: "check the backend logs" (when user mentions a specific project)**
```typescript
// Step 1: Identify which instance is the "backend" by checking instance names
// You may need to ask the user or infer from project structure

// Step 2: Use searchInstanceLogs with the backend instance ID
run_vscode_command({
  commandId: "copilotAssistant.searchInstanceLogs",
  args: ["backend-instance-id", ""]  // Empty pattern = all logs
})

// Step 3: Read results
read_file({
  filePath: "<workspace>/.copilot-assistant/search-results-backend-instance-id.txt",
  startLine: 1,
  endLine: 10000
})
```

**User: "find network errors"**
```typescript
run_vscode_command({
  commandId: "copilotAssistant.searchInstanceLogs",
  name: "Search for network errors",
  args: ["<instanceId>", "type=NetworkError"]
})

read_file({
  filePath: "<workspace>/.copilot-assistant/search-results-<instanceId>.txt",
  startLine: 1,
  endLine: 10000  // Large number ensures all lines are read
})
```

**User: "show critical issues"**
```typescript
run_vscode_command({
  commandId: "copilotAssistant.searchInstanceLogs",
  name: "Search for critical issues",
  args: ["<instanceId>", "severity=CRITICAL"]
})

read_file({
  filePath: "<workspace>/.copilot-assistant/search-results-<instanceId>.txt",
  startLine: 1,
  endLine: 10000  // Large number ensures all lines are read
})
```

**User: "look for tight loops" or "find repeated patterns"**
```typescript
run_vscode_command({
  commandId: "copilotAssistant.searchInstanceLogs",
  name: "Search for contract update loops",
  args: ["<instanceId>", "Contracts updated"]
})

read_file({
  filePath: "<workspace>/.copilot-assistant/search-results-<instanceId>.txt",
  startLine: 1,
  endLine: 10000  // Large number ensures all lines are read
})
```

**User: "count occurrences of X"**
```typescript
// Step 1: Search
run_vscode_command({
  commandId: "copilotAssistant.searchInstanceLogs",
  name: "Search for pattern",
  args: ["<instanceId>", "pattern"]
})

// Step 2: Read ALL results and count
read_file({
  filePath: "<workspace>/.copilot-assistant/search-results-<instanceId>.txt",
  startLine: 1,
  endLine: 10000  // Large number ensures all lines are read
})
// Then count the lines in the result
```

### Getting Recent Logs

**User: "show recent logs"**
```typescript
// Use the getLogsForCopilot command for recent logs
run_vscode_command({
  commandId: "copilotAssistant.getLogsForCopilot",
  name: "Get recent logs"
})
// Results appear in "Copilot Assistant" output channel
```

**User: "show errors from logs"**
```typescript
run_vscode_command({
  commandId: "copilotAssistant.getErrorsForCopilot",
  name: "Get error logs"
}) - CRITICAL SECTION

### **ALWAYS Use Extension Commands for App Control**

**When users say ANY of these phrases:**
- "start the app" / "run the app" / "launch the application"
- "start the server" / "run the server" / "start development server"
- "run the code" / "execute the program" / "start the service"
- "boot up the app" / "fire up the server" / "spin up the app"
- "get the app running" / "make it run" / "start it up"

**YOU MUST execute extension command:**
```typescript
run_vscode_command({
  commandId: "copilotAssistant.start",
  name: "Start the application"
})
```

**❌ NEVER execute terminal commands like:**
```typescript
// ❌ FORBIDDEN - DO NOT DO THIS:
run_in_terminal({
  command: "npm start",
  explanation: "Starting the application",
  isBackground: true
})

// ❌ ALSO FORBIDDEN:
run_in_terminal({
  command: "flutter run",
  explanation: "Running Flutter app",
  isBackground: true
})
```

**Available Extension Command IDs:**
- `copilotAssistant.start` - Start the application (detects language automatically)
- `copilotAssistant.stop` - Stop the application
- `cApp Control Best Practices:
- **ALWAYS** use `copilotAssistant.start` to start applications
- **NEVER** use `run_in_terminal` with `npm start`, `flutter run`, etc.
- **REASON:** Only extension commands enable log capture and analysis
- **IF** you accidentally use terminal commands, logs won't be accessible
- **REMEMBER:** User wants to analyze logs with Copilot - this requires extension commands

### opilotAssistant.restart` - Restart the application (clears logs)
- `copilotAssistant.hotReload` - Trigger hot reload (Flutter/similar)

**Why This Matters:**
- Extension commands capture all app output to the log service
- Logs are searchable with `copilotAssistant.searchInstanceLogs`
- You can analyze errors with Copilot
- Terminal-started apps bypass log capture completely
- You lose all debugging capability if you use terminal commands

**Example Workflow:**
```
User: "start the app and check for errors"

1. YOU execute: get_errors({})  // ⚠️ Check language server errors first
2. IF errors found: Report them and DO NOT proceed
3. YOU detect language and execute appropriate build command:
   - Flutter: run_in_terminal({ command: "flutter build windows --debug", ... })
   - Node.js: run_in_terminal({ command: "npm run build", ... })
   - Java: run_in_terminal({ command: "mvn compile", ... })
   - .NET: run_in_terminal({ command: "dotnet build", ... })
   - etc.
4. IF build fails: Report build errors and DO NOT start app
5. IF build succeeds: run_vscode_command({ commandId: "copilotAssistant.start" })
6. YOU wait: 2-3 seconds for app to start
7. YOU execute: run_vscode_command({ commandId: "copilotAssistant.getInstancesForCopilot" })
8. YOU execute: read_file({ filePath: "<workspace>/.copilot-assistant/instances.json" })
9. YOU execute: run_vscode_command({ commandId: "copilotAssistant.searchInstanceLogs", args: ["<instanceId>", "ERROR"] })
10. YOU execute: read_file({ filePath: "<workspace>/.copilot-assistant/search-results-<instanceId>.txt" })
9. YOU analyze: Results and provide guidance
```

**Another Example:**
```
User: "restart the server"

1. YOU execute: get_errors({})  // ⚠️ Check language server errors first
2. IF errors found: Report them and DO NOT proceed
3. YOU detect language and run appropriate build command
4. IF build fails: Report build errors and DO NOT restart app
5. IF build succeeds: run_vscode_command({ commandId: "copilotAssistant.restart" })
6. Wait for restart to complete
7. Logs are automatically captured and available for analysis
```

**Code Change Workflow:**
```
User: "I fixed the bug, restart the app"

1. YOU execute: get_errors({})  // ⚠️ Validate language server shows no errors
2. IF errors still exist: Inform user and DO NOT proceed
3. YOU detect language and run appropriate build command
4. IF build fails: Inform user the fix didn't compile, show build errors
5. IF build succeeds: run_vscode_command({ commandId: "copilotAssistant.restart" })
6. Confirm successful restart
```

---

## 💡 Pro Tips

### Search Best Practices:
- **Exact matches**: Search for specific log levels like "ERROR", "WARN", "INFO"
- **Metadata**: Use metadata fields like "severity=HIGH" or "type=NetworkError"
- **Partial matches**: Search works with substring matching (case-insensitive)
- **Read results**: Always read `search-results-{instanceId}.txt` after searching

### Available Commands:
- `copilotAssistant.searchInstanceLogs` - Search in-memory logs for a specific instance, writes to `search-results-{instanceId}.txt`
- `copilotAssistant.searchLogs` - Legacy search for the active instance (also writes to `search-results-{instanceId}.txt`)
- `copilotAssistant.getSearchResults` - Get last search results programmatically
- `copilotAssistant.getLogsForCopilot` - Get recent logs in output channel
- `copilotAssistant.getErrorsForCopilot` - Get error logs in output channel
- `copilotAssistant.getHealthForCopilot` - Get health status in output channel

### Output Channel:
- All log analysis appears in **"Copilot Assistant"** output channel (unified)
- Use notification messages to guide users to check the output panel