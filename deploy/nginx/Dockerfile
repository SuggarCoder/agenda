FROM nginx:1.28-alpine
COPY *.template /opt/agenda/
COPY start.sh /opt/agenda/start.sh
ENTRYPOINT ["/bin/sh", "/opt/agenda/start.sh"]
