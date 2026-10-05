FROM nginx:alpine

COPY web/ /usr/share/nginx/html/
COPY translations/ /usr/share/nginx/html/translations/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
