WITH t(pid, new_title) AS (
  VALUES
    ('345b6227-7a45-400d-a11f-665cc4a85edd'::uuid, 'TradePathways Africa'),
    ('1abbb514-cd29-4f99-8a52-3fdcb3de2510'::uuid, 'Savor Haven'),
    ('b5cc5dcc-e430-4482-ad74-bcd14765daf7'::uuid, 'Virtual Closet Try-On'),
    ('eb12f23a-1339-49ec-ab89-e2d09eb6d5d3'::uuid, 'Ironline Construction'),
    ('a309bb0e-fc8c-440e-b957-b65cb6ed72aa'::uuid, 'Aura Mood Tracker'),
    ('d01c8e49-b98b-4c91-8820-ee04725e9ab0'::uuid, 'Recipe Scaler Studio'),
    ('0159a4a5-ea11-47e6-9bb5-96e4f83e2905'::uuid, 'Miko Meme Exchange'),
    ('fc3784c9-8e32-4dd2-8617-a63972d9be69'::uuid, 'Live Market Terminal'),
    ('1a07d0a3-b857-4a92-b6be-2e57364c59ef'::uuid, 'Crypto Analytics Dashboard'),
    ('da89b75a-3892-43d6-ab03-8edb5e07f48e'::uuid, 'CypherFund Investments'),
    ('df9b6038-9b27-4533-b76c-a042e6850b8d'::uuid, 'FitCheck Scrapbook'),
    ('657fe5a4-fb13-48fd-99f0-f5ea7ea35fa5'::uuid, 'FitCheck Studio'),
    ('8d319053-bdcb-4503-b9b7-60526facb629'::uuid, 'Kinetic Studio'),
    ('ac2a721a-f67a-4a27-a47e-e6c9cb7832ff'::uuid, 'NEO Rental Marketplace'),
    ('96628596-6a64-4b11-bd55-803d8ff770b2'::uuid, 'Kesh Socials'),
    ('f0765d08-8cce-43a7-9b7e-226c9d0da3ab'::uuid, 'Aurelius Cleaning'),
    ('5d9a9493-dd9b-4dac-9d75-49abadd98dec'::uuid, 'Bibliophile Book Tracker'),
    ('896de0c4-7e1e-4649-9fb1-e3eb45bb077b'::uuid, 'Snackwave'),
    ('030ed0eb-3b47-494a-9812-c3b1fb9e1b4e'::uuid, 'Flowy Period Tracker'),
    ('146a8ea6-ce5f-4f2d-82b5-f941d560ba9c'::uuid, 'Heirloom Kitchen'),
    ('a2d24a98-d012-465b-8810-636235df2aea'::uuid, 'Lumina Storefront')
)
UPDATE public.projects p
SET title = t.new_title,
    slug = trim(both '-' from regexp_replace(lower(t.new_title), '[^a-z0-9]+', '-', 'g'))
           || '-' || substr(replace(p.id::text, '-', ''), 1, 6)
FROM t
WHERE p.id = t.pid;