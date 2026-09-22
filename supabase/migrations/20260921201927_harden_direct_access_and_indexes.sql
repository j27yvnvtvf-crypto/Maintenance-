create index if not exists work_orders_created_by_idx
  on public.work_orders(created_by);

-- All operational access goes through authenticated Next.js server routes.
-- These explicit deny policies provide defense in depth for browser clients.
create policy "members_server_only"
  on public.members
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "work_orders_server_only"
  on public.work_orders
  for all
  to anon, authenticated
  using (false)
  with check (false);
