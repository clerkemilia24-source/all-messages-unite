<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep six-tab navigation in the shared BottomNav on authenticated screens, with Wallet as a tab and Contacts reached from New Chat; this maintains consistent active states and safe-area spacing without duplicating destinations.
- Keep Liquid Glass colors and surface effects in global semantic CSS tokens/utilities; this lets chat and navigation share one theme.
- Keep message and call content on solid surfaces while limiting translucent glass to interface chrome; this preserves contrast over chat content.
- Use the device keyboard for chat emoji entry and standard file inputs for gallery/camera selection; browsers cannot open a phone's emoji tab directly, and native inputs preserve familiar platform pickers.
