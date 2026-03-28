FROM nginx:alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

COPY index.html 404.html favicon.svg content-manifest.json /usr/share/nginx/html/reads/
COPY assets/ /usr/share/nginx/html/reads/assets/
COPY content/ /usr/share/nginx/html/reads/content/

EXPOSE 80
