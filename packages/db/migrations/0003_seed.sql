-- Act One :: platform bootstrap
--
-- Seeds only the singleton configuration rows. Plans are seeded empty on
-- purpose: the application writes its default catalogue on first boot and
-- Super Admin owns it from then on, so a migration never overwrites pricing
-- somebody changed in production.

INSERT INTO platform_settings (id)
VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;
