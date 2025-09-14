-- Insert admin user directly into auth.users table
-- This bypasses the signup flow since signups appear to be disabled
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'admin@containeryard.com',
  crypt('admin123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Admin User"}',
  false,
  '',
  '',
  '',
  ''
);

-- Get the user ID that was just created and insert into profiles
WITH new_user AS (
  SELECT id, email FROM auth.users WHERE email = 'admin@containeryard.com'
)
INSERT INTO public.profiles (user_id, full_name, role)
SELECT id, 'Admin User', 'admin'::app_role
FROM new_user;