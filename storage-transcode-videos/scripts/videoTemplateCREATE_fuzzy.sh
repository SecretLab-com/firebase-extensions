#!/bin/zsh 
gcloud config set project fuzzy-day
gcloud transcoder templates delete projects/614291199950/locations/us-central1/jobTemplates/fuzzy_explore_video --location=us-central1 --quiet
gcloud transcoder templates create fuzzy_explore_video --file="videoTemplate.json" --location=us-central1 > /dev/null
echo Created template fuzzy_explore_video