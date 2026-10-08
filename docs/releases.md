# My release checklist

1. Commit the finished changes and leave the working tree clean.
2. Pick an unused `vMAJOR.MINOR.PATCH` version: patch for compatible fixes,
   minor for compatible features, major for breaking changes. Optional config
   additions or automatic migrations don't by themselves require a major bump.
3. Tag and push. Replace `1.0.1` below with the chosen version:

   ```bash
   git tag v1.0.1
   git push origin HEAD
   git push origin v1.0.1
   ```

4. Wait for **Actions → Linux release** to pass and create a draft release.
   It includes the Linux x86-64 AppImage, `install-launcher.sh` and `SHA256SUMS`.
5. Download all three files from the draft and test that exact AppImage:

   ```bash
   sha256sum -c SHA256SUMS
   chmod +x AgentDeck-1.0.1.AppImage
   ./AgentDeck-1.0.1.AppImage --no-sandbox --ozone-platform-hint=auto
   ```

   Check the version, existing settings, an AI terminal, Git status/diffs,
   the editor and anything changed in this release. Close and reopen the app.
   AppImages share `~/.config/agentdeck/`; back it up before testing config changes.
6. Edit the draft notes: summarize changes and mention any upgrade steps or
   known issues. Then click **Publish release**. Testing on my own machine is
   enough; other setups are unverified unless someone tests them.

For daily use, put the downloaded AppImage in `~/Applications/` and run
`sh install-launcher.sh "$HOME/Applications/AgentDeck-1.0.1.AppImage"`.
`./scripts/release.sh` is the alternative for building and installing a tagged
checkout locally; public drafts are created by GitHub Actions.

If CI fails, check its logs and rerun after a transient failure. If code needs
fixing, commit the fix and use a new tag. The workflow won't replace an existing
release's files; keep published tags and downloads intact.
