# Development

```powershell
npm ci
npm run build
npm test
python -X utf8 -m pytest backend/tests
.\scripts\setup-backend.ps1 -Vault "C:\path\to\vault"
.\scripts\install-dev.ps1 -Vault "C:\path\to\vault" -PythonExecutable "<venv-python>" -Enable
```

Unit and integration tests use the deterministic `__fake__` embedding model and do not download a model. Real-model smoke tests are Windows-only manual checks.
