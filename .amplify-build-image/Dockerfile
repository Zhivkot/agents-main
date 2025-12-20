# Custom Amplify Build Image with Docker and Node.js 22
FROM public.ecr.aws/codebuild/amazonlinux2-x86_64-standard:5.0

# Update system and ensure GLIBC is up to date
RUN yum update -y && yum install -y glibc glibc-devel

# Install Node.js 22 (compatible with newer GLIBC)
RUN curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - \
    && yum install -y nodejs

# Install nvm for Amplify compatibility
ENV NVM_DIR=/root/.nvm
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Add nvm to bashrc for Amplify compatibility
RUN echo 'export NVM_DIR="$HOME/.nvm"' >> /root/.bashrc \
    && echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> /root/.bashrc \
    && echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> /root/.bashrc

# Verify installations and GLIBC version
RUN echo "Checking GLIBC version:" && ldd --version \
    && echo "Node.js version:" && node --version \
    && echo "npm version:" && npm --version \
    && echo "Docker version:" && docker --version

# Set working directory
WORKDIR /codebuild/output

# Keep the entrypoint from the base image
ENTRYPOINT ["/usr/local/bin/dockerd-entrypoint.sh"]
