ALTER TABLE public.v3_customer_accounts DISABLE TRIGGER v3_customer_accounts_domain_collision;
UPDATE public.v3_customer_accounts SET account_key = 'cactus_gaming' WHERE account_key = 'Cactus Gaming';
ALTER TABLE public.v3_customer_accounts ENABLE TRIGGER v3_customer_accounts_domain_collision;