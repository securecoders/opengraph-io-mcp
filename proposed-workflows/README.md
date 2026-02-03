# Proposed Workflows

These workflow files need to be moved to `.github/workflows/` to activate.

## publish-mcp-registry.yml

Publishes to the Official MCP Registry when version tags are pushed.

### To activate:
```bash
mkdir -p .github/workflows
mv proposed-workflows/publish-mcp-registry.yml .github/workflows/
rm -r proposed-workflows  # cleanup
```

### How it works:
1. Triggered on `v*` tags (e.g., `v1.4.0`)
2. Uses GitHub OIDC authentication (no secrets needed)
3. Auto-updates version in `server.json` from git tag
4. Publishes to Official MCP Registry

### Release process:
```bash
npm publish
git tag v1.4.0
git push origin v1.4.0
# Workflow auto-publishes to MCP Registry
```
