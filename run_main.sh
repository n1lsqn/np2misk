#!/bin/bash

cd /home/n1lsqn/workspaces/np2misk/
 
if [ -x ./np2misk ]; then
    ./np2misk
  else
    echo "Error: ./np2misk not found or not executable."
fi

while true; do
    ./np2misk
    if [ $? -eq 0 ]; then
      echo "Execution completed successfully. Exiting."
      exit 0
        else
          echo "Error occurred. Retrying..."
            sleep 1
    fi
done