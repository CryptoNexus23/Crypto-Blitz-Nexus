#!/bin/bash
echo "🚀 Starting Nexus via HTTP server..."
cd /opt/nexus
http-server -p 8080 --cors
