# K_Notes migration and rollback

1. Keep `9_System/scripts/hybrid-search` and its index intact.
2. Stop the legacy daemon with `python -X utf8 query.py --stop-server`.
3. Install and enable this plugin with `install-dev.ps1`.
4. Reload Obsidian, then build a new LocalAppData index from plugin settings.
5. Compare representative top-20 results and verify create/modify/delete/rename synchronization.
6. Disable the plugin and confirm its Python PID exits before considering the migration complete.
7. Only then update agent instructions to the new `vault-search` CLI.

Rollback: disable **Vault Search Service**, confirm the sidecar exits, and run the unchanged legacy `query.py --json --top 20` entry point. Do not delete either index until rollback has been tested.
