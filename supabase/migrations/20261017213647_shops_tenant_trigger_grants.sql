-- The two trigger functions from shops_tenant are fired by their triggers only; nobody
-- calls them through the API. Default grants had made them callable over /rest/v1/rpc,
-- which the security advisor flagged.
revoke all on function public.ensure_shop_for_listing(), public.shop_customer_on_signup() from public, anon, authenticated;
