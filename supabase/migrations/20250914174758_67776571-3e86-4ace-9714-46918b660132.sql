-- Update existing user to be admin
UPDATE public.profiles 
SET role = 'admin'::app_role, full_name = 'Admin User'
WHERE user_id = 'a096b98a-51b7-4be2-9aa7-dd8d1cf916ad';

-- If no profile exists, create one
INSERT INTO public.profiles (user_id, full_name, role)
SELECT 'a096b98a-51b7-4be2-9aa7-dd8d1cf916ad', 'Admin User', 'admin'::app_role
WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = 'a096b98a-51b7-4be2-9aa7-dd8d1cf916ad'
);