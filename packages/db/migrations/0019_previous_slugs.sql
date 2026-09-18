-- Act One :: addresses a page used to have
--
-- When a published page changes its address, every link anyone made to the
-- old one dies. The old addresses are kept on the document, and the public
-- pages answer them with a permanent redirect instead of a 404, so the link
-- somebody posted last month still lands on the film or the article.
--
-- These indexes make that lookup cheap: the redirect runs on every request
-- for an address that is not a current one, which is exactly what a crawler
-- following stale links does all day.

CREATE INDEX articles_previous_slugs_idx
  ON articles USING GIN ((data -> 'previousSlugs') jsonb_path_ops);

CREATE INDEX collection_entries_previous_slugs_idx
  ON collection_entries USING GIN ((data -> 'previousSlugs') jsonb_path_ops);
