-- Create a table in the exposed 'api' schema
CREATE TABLE api.posts (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT
);

-- Give the 'anon' role permission to see it
GRANT SELECT ON api.posts TO anon;

-- Add a "Hello World" entry
INSERT INTO api.posts (title, content) 
VALUES ('Flux is alive', 'This API was generated on the fly.');
