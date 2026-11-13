-- __SCHEMA__ is replaced only after validating a generated harness identifier.
CREATE SCHEMA __SCHEMA__;
SET search_path TO __SCHEMA__, pg_catalog;

CREATE TABLE accounts (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'),
  owner_id text NOT NULL CHECK (owner_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'),
  balance bigint NOT NULL CHECK (balance BETWEEN 0 AND 1000000000)
);
CREATE TABLE shop (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'),
  price bigint NOT NULL CHECK (price BETWEEN 1 AND 1000000000),
  stock bigint NOT NULL CHECK (stock BETWEEN 0 AND 1000000000)
);
CREATE TABLE inventory (
  account_id text NOT NULL REFERENCES accounts(id),
  item_id text NOT NULL REFERENCES shop(id),
  quantity bigint NOT NULL CHECK (quantity BETWEEN 0 AND 1000000000),
  PRIMARY KEY (account_id, item_id)
);
CREATE TABLE treasury (
  id integer PRIMARY KEY CHECK (id = 1),
  balance bigint NOT NULL CHECK (balance BETWEEN 0 AND 9007199254740991)
);
INSERT INTO treasury VALUES (1, 0);
CREATE TABLE successful_requests (
  principal_id text NOT NULL,
  request_key text NOT NULL,
  command jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (principal_id, request_key)
);

-- Invoker rights only. This function is a test reference, not an authenticated API.
CREATE FUNCTION purchase(p_principal text, p_key text, p_account text, p_item text, p_quantity integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path = __SCHEMA__, pg_catalog AS $purchase$
DECLARE
  a accounts%ROWTYPE;
  i shop%ROWTYPE;
  old_request successful_requests%ROWTYPE;
  command_value jsonb;
  result_value jsonb;
  cost bigint;
  owned_quantity bigint;
  treasury_balance bigint;
BEGIN
  IF p_principal IS NULL OR p_key IS NULL OR p_account IS NULL OR p_item IS NULL
     OR p_principal !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'
     OR p_key !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'
     OR p_account !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'
     OR p_item !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'
     OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 1000000000 THEN
    RETURN jsonb_build_object('status','denied','reason','INVALID_COMMAND');
  END IF;
  -- Serialize a key across independent connections. Hash collisions only add contention.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_principal || ':' || p_key, 0));
  SELECT * INTO a FROM accounts WHERE id = p_account FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','denied','reason','ACCOUNT_MISSING'); END IF;
  IF a.owner_id <> p_principal THEN
    RETURN jsonb_build_object('status','denied','reason','OWNERSHIP_DENIED');
  END IF;
  command_value := jsonb_build_object('principal',p_principal,'account',p_account,'item',p_item,'quantity',p_quantity);
  SELECT * INTO old_request FROM successful_requests WHERE principal_id = p_principal AND request_key = p_key;
  IF FOUND THEN
    IF old_request.command = command_value THEN
      RETURN old_request.result || jsonb_build_object('status','replayed','reason','SAME_COMMAND_NO_EFFECT');
    END IF;
    RETURN jsonb_build_object('status','denied','reason','KEY_CONFLICT');
  END IF;

  SELECT * INTO i FROM shop WHERE id = p_item FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','denied','reason','ITEM_MISSING'); END IF;
  cost := i.price * p_quantity::bigint;
  IF i.stock < p_quantity THEN RETURN jsonb_build_object('status','denied','reason','INSUFFICIENT_STOCK'); END IF;
  IF a.balance < cost THEN RETURN jsonb_build_object('status','denied','reason','INSUFFICIENT_FUNDS'); END IF;
  SELECT quantity INTO owned_quantity FROM inventory WHERE account_id = p_account AND item_id = p_item;
  owned_quantity := COALESCE(owned_quantity, 0);
  IF owned_quantity + p_quantity > 1000000000 THEN
    RETURN jsonb_build_object('status','denied','reason','INVENTORY_LIMIT');
  END IF;
  SELECT balance INTO treasury_balance FROM treasury WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE_TREASURY_MISSING'; END IF;
  IF treasury_balance + cost > 9007199254740991 THEN
    RETURN jsonb_build_object('status','denied','reason','TREASURY_LIMIT');
  END IF;

  UPDATE accounts SET balance = balance - cost WHERE id = p_account;
  UPDATE shop SET stock = stock - p_quantity WHERE id = p_item;
  INSERT INTO inventory(account_id,item_id,quantity) VALUES (p_account,p_item,p_quantity)
    ON CONFLICT (account_id,item_id) DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity;
  UPDATE treasury SET balance = balance + cost WHERE id = 1;
  result_value := jsonb_build_object('status','applied','reason','CHECKS_PASSED','cost',cost,'quantity',p_quantity);
  INSERT INTO successful_requests VALUES (p_principal, p_key, command_value, result_value);
  RETURN result_value;
END
$purchase$;
