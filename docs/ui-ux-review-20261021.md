# Ranking UI/UX — 21 October 2026

## Changes

- Show six usage choices directly, with separate suitability/value buttons. Public pages initially show suitability so phones without confirmed prices can still be assessed. The source-sales sort remains in the methodology panel.
- Keep search and feed budget filters compact. The budget still describes the feed reference before coupons, not the manually entered purchase price.
- Put the model name, usage score, provisional status and evidence coverage first. Keep the full formulas, sources, missing evidence and source-sales counts in expandable sections. Source sales still have no stated period.
- Distinguish waiting for price/variant, waiting for model identity and waiting for evidence. Never generate a rank just to fill an empty state.
- Show selected model names in the comparison tray, with individual removal and a four-model limit. Preserve model IDs and the chosen profile in comparison links.
- Put manual reference price entry first in each admin card. Keep pending-edit counts and save controls visible; show action feedback beside its field and save feedback inside its card. Collapsed cards retain an edit affordance on mobile.

## Verification

- Playwright CLI, headed Chrome, 390×844 and 1365×950 viewports: usage/sort controls, product rows, comparison selection/removal, admin login, price save and missing-price confirmation feedback.
- Local admin edits used a temporary data directory and synthetic evidence for two test phones. No QA prices or test evidence were written to production.
- Node suite: 115 passed. Python suite: 83 passed, 1 skipped (raw research file absent in checkout).
- No scoring weights, eligibility rules, affiliate URL construction or production catalog data changed.

## Next improvements

1. Populate confirmed reference prices with RAM/storage, coupon conditions and observation time. The current budget bands intentionally remain feed-based until reliable current prices exist.
2. Add verified model-specific images to distinguish similar names.
3. Gather comparable real-world camera, gaming and livestream evidence. Layout changes cannot replace the missing evidence required for these rankings.
