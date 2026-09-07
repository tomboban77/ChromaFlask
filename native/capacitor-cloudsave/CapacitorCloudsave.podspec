require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'CapacitorCloudsave'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/tomboban77/ChromaFlask'
  s.author = 'Prism Potions'
  s.source = { :git => 'https://github.com/tomboban77/ChromaFlask.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.4'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
