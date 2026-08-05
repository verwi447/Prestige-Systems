# Prestige Systems HUB Windows Service

Run PowerShell as Administrator from the project root.

If PowerShell blocks `.ps1` files, use the `.cmd` files instead.

Install service:

```powershell
.\service\install-service.ps1
```

or:

```cmd
.\service\install-service.cmd
```

Restart service:

```powershell
.\service\restart-service.ps1
```

or:

```cmd
.\service\restart-service.cmd
```

Uninstall service:

```powershell
.\service\uninstall-service.ps1
```

or:

```cmd
.\service\uninstall-service.cmd
```

The service runs the backend on port `5000`. If `frontend/dist` exists, the backend also serves the web app.
