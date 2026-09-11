-- Enforce the game rule at database level: one player can belong to one alliance.
-- Run only after confirming there are no duplicate player_id rows.
create unique index if not exists alliance_members_one_alliance_per_player
  on public.alliance_members (player_id);
