-- Phase 2 cleanup: the global PO sequence and the uuid-only shop resolver are retired.
--
-- phase2_self_serve_shops (20261020181706) gave every shop its own PO counter
-- (shops.po_prefix / po_next, handed out by next_po_number(uuid) to submit-order) and a
-- resolver that takes a slug or an id (ordering_shop_by_ref), and left the old
-- next_po_number() / po_number_seq pair and ordering_shop(uuid) in place so the app build
-- that was live at the time kept working. The Phase 2 build has been live and verified
-- (docs/phase2-self-serve-shop-design.md §11): it never calls either, and submit-order
-- calls next_po_number with p_shop. Nothing else references them — checked on the hosted
-- project before this was written: no function body but next_po_number() itself, no
-- policy, view, trigger or column default, and the live bundle has no such string.
--
-- APPLY ONLY WHILE A PHASE 2 BUILD (PR #59 or later) IS LIVE ON shop.roofcoil.com: the
-- build before it pre-allocated a PO number with next_po_number() and resolved ?shop=
-- with ordering_shop(uuid).

-- The browser used to take a number from the global sequence before every order. The
-- sequence stopped at 1006; Fortified's own counter continued from 1007.
drop function if exists public.next_po_number();
drop sequence if exists public.po_number_seq;

-- ?shop=<id or slug> goes through ordering_shop_by_ref(text) now, for anonymous and
-- signed-in callers alike.
drop function if exists public.ordering_shop(uuid);
