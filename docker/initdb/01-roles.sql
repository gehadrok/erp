-- Runs on first initialization of the erp database.
-- Creates the three documented DB roles (02-architecture / 12-security):
--  erp_migrator : DDL owner (runs migrations)
--  erp_app      : DML runtime role, subject to RLS
--  erp_readonly : reports role
-- Passwords here are development defaults; override in real environments.
\set owner_pw 'erp_owner_pw'
\set migrator_pw 'erp_migrator_pw'
\set app_pw 'erp_app_pw'
\set readonly_pw 'erp_readonly_pw'

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_migrator') THEN
    CREATE ROLE erp_migrator LOGIN PASSWORD 'erp_migrator_pw';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app LOGIN PASSWORD 'erp_app_pw';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_readonly') THEN
    CREATE ROLE erp_readonly LOGIN PASSWORD 'erp_readonly_pw';
  END IF;
END
$$;

GRANT erp_app, erp_readonly TO erp_migrator;
